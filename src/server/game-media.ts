import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db/client";
import { gameAssets, gameRooms, gamePlayers } from "../db/game-room-schema";
import { gameService } from "./game-http";
import type { GamePrincipal } from "./game-room-service";
import { imageObjectStore } from "./image-storage";
import { persistManagedImage } from "./image-persistence";
import { compressUploadedImage } from "./image-compression";
import { authorizedImageResponse } from "./image-delivery";
import { authorizedVideoResponse } from "./video-delivery";
import { canReadGameAsset, requireGameUpload } from "./game-media-core";
import { readGameRun } from "./game-run-service";
import { AppError } from "./errors";
import { readBody } from "./http";
export async function uploadGameAsset(request: Request, roomId: string, who: GamePrincipal) {
  const view = await gameService().read(roomId, who);
  const input = await readBody(request, 21 * 1024 * 1024);
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: new Uint8Array(input),
    }).formData();
  } catch {
    throw new AppError("VALIDATION", "올바른 업로드 형식으로 요청해주세요.");
  }
  const file = form.get("file"),
    kind = z.enum(["drawing", "photo", "audio", "video"]).parse(form.get("kind"));
  const phaseId =
    typeof form.get("phaseId") === "string" ? z.uuid().parse(form.get("phaseId")) : null;
  requireGameUpload(view, kind, phaseId);
  if (
    !(file instanceof File) ||
    file.size < 1 ||
    file.size > (kind === "video" ? 20 : kind === "audio" ? 5 : 10) * 1024 * 1024
  )
    throw new AppError("VALIDATION", "사진 10MB·소리 5MB·영상 20MB 이하의 파일을 선택해주세요.");
  if (
    (kind === "audio" &&
      ![
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "audio/webm",
      ].includes(file.type)) ||
    (kind === "video" && !["video/mp4", "video/webm", "video/quicktime"].includes(file.type))
  )
    throw new AppError("VALIDATION", "지원하는 소리·영상 파일을 선택해주세요.");
  const bytes =
    kind === "photo" || kind === "drawing"
      ? await compressUploadedImage(Buffer.from(await file.arrayBuffer()), "post")
      : new Uint8Array(await file.arrayBuffer());
  const db = getDatabase(),
    store = imageObjectStore(),
    id = randomUUID(),
    storageKind = kind === "photo" || kind === "drawing" ? "post" : "video",
    objectKey = `${randomUUID()}.${storageKind === "post" ? "webp" : "mp4"}`,
    token = randomUUID();
  await db.transaction(async (tx) => {
    const [room] = await tx.select().from(gameRooms).where(eq(gameRooms.id, roomId)).for("update");
    if (
      !room ||
      room.expiresAt <= new Date() ||
      room.phase !== view.phase ||
      (kind === "drawing" && room.drawing?.phaseId !== phaseId)
    )
      throw new AppError("CONFLICT", "단계가 바뀌었어요. 다시 확인해주세요.");
    const [seat] = await tx
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.roomId, roomId), eq(gamePlayers.identityHash, who.identityHash)));
    if (who.actor !== room.hostId && seat?.status !== "admitted")
      throw new AppError("FORBIDDEN", "입장 권한이 변경됐어요.");
    const [count] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        mine: sql<number>`count(*) filter (where ${gameAssets.uploaderHash}=${who.identityHash})::int`,
      })
      .from(gameAssets)
      .where(eq(gameAssets.roomId, roomId));
    if ((count?.total ?? 0) >= 160 || (count?.mine ?? 0) >= 40)
      throw new AppError("RATE_LIMITED", "이 방에 올릴 수 있는 자료 수를 채웠어요.");
    await tx.insert(gameAssets).values({
      id,
      roomId,
      runId: room.drawing?.runId ?? room.clue?.runId ?? null,
      uploaderHash: who.identityHash,
      phaseId,
      kind,
      status: "processing",
      storageBackend: store.backend,
      objectKey,
      sourceKey: null,
      contentType: storageKind === "post" ? "image/webp" : "video/mp4",
      byteSize: bytes.byteLength,
      lockToken: token,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      expiresAt: room.expiresAt,
    });
  });
  try {
    await persistManagedImage(db, store, storageKind, objectKey, bytes, async (tx) => {
      const updated = await tx
        .update(gameAssets)
        .set({
          status: storageKind === "post" ? "ready" : "queued",
          lockToken: null,
          leaseExpiresAt: null,
          sourceKey: storageKind === "video" ? objectKey : null,
        })
        .where(and(eq(gameAssets.id, id), eq(gameAssets.lockToken, token)))
        .returning({ id: gameAssets.id });
      if (!updated.length) throw new AppError("CONFLICT", "자료 보관 시간이 지났어요.");
    });
  } catch (error) {
    await db
      .update(gameAssets)
      .set({ status: "failed", lockToken: null, leaseExpiresAt: null })
      .where(eq(gameAssets.id, id))
      .catch(() => {});
    throw error;
  }
  return {
    id,
    status: storageKind === "post" ? "ready" : "queued",
    src: `/api/games/${roomId}/media/${id}${view.isHost ? "?host=1" : ""}`,
  };
}
export async function readGameAsset(
  request: Request,
  roomId: string,
  id: string,
  who: GamePrincipal,
) {
  const [asset] = await getDatabase()
    .select()
    .from(gameAssets)
    .where(and(eq(gameAssets.id, z.uuid().parse(id)), eq(gameAssets.roomId, roomId)));
  if (!asset || asset.expiresAt <= new Date())
    throw new AppError("NOT_FOUND", "사용 기간이 지난 게임 자료예요.");
  const view = await gameService().read(roomId, who);
  if (!canReadGameAsset(view, asset, who.identityHash)) {
    if (!asset.runId) throw new AppError("NOT_FOUND", "지금 볼 수 있는 자료가 아니에요.");
    const previous = await readGameRun(getDatabase(), roomId, asset.runId, who);
    if (!canReadGameAsset(previous, asset, who.identityHash))
      throw new AppError("NOT_FOUND", "지금 볼 수 있는 자료가 아니에요.");
  }
  if (new URL(request.url).searchParams.get("status") === "1")
    return Response.json(
      {
        ok: true,
        data: {
          id: asset.id,
          status: asset.status,
          src: `/api/games/${roomId}/media/${id}${view.isHost ? "?host=1" : ""}`,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  if (asset.status !== "ready")
    throw new AppError(
      "CONFLICT",
      asset.status === "failed"
        ? "자료를 처리하지 못했어요. 다른 파일을 선택해주세요."
        : "자료를 처리하고 있어요.",
    );
  const store = imageObjectStore(asset.storageBackend);
  if (asset.kind === "drawing" || asset.kind === "photo")
    return authorizedImageResponse(
      request,
      {
        id: asset.id,
        byteSize: asset.byteSize,
        contentType: asset.contentType,
        browserCache: true,
      },
      () => store.read("post", asset.objectKey),
    );
  const response = await authorizedVideoResponse(request, asset.byteSize, async (range, signal) => {
    if (store.readRange) return store.readRange("video", asset.objectKey, range, signal);
    const bytes = await store.read("video", asset.objectKey);
    return new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(range.start, range.end + 1));
        c.close();
      },
    });
  });
  response.headers.set("Content-Type", asset.kind === "audio" ? "audio/mp4" : "video/mp4");
  return response;
}
