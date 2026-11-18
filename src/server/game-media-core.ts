import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { gameAssets, gameRooms, gameRuns } from "../db/game-room-schema";
import type { GameRoomView } from "../domain/game-room";
import { enqueueObjectCleanup } from "./object-cleanup-service";
import { AppError } from "./errors";
export function canReadGameAsset(
  view: GameRoomView,
  asset: { id: string; uploaderHash: string },
  identityHash: string,
) {
  if (view.phase === "closed" || (!view.isHost && view.viewer.status !== "admitted")) return false;
  if (asset.uploaderHash === identityHash) return true;
  const visible = new Set<string>();
  const drawing = view.drawing;
  if (drawing?.assignment?.image) visible.add(drawing.assignment.image);
  for (const c of drawing?.revealed ?? []) {
    if (c.image) visible.add(c.image);
    if (c.finalImage) visible.add(c.finalImage);
  }
  const clue = view.clue;
  if (clue?.question?.assetId) visible.add(clue.question.assetId);
  for (const r of [...(clue?.results ?? []), ...(clue?.result ? [clue.result] : [])])
    if (r.question.assetId) visible.add(r.question.assetId);
  return visible.has(asset.id);
}
export function requireGameUpload(view: GameRoomView, kind: string, phaseId: string | null) {
  if (!view.isHost && view.viewer.status !== "admitted")
    throw new AppError("FORBIDDEN", "입장한 참가자만 자료를 올릴 수 있어요.");
  if (kind === "drawing") {
    const d = view.drawing;
    if (
      view.phase !== "playing" ||
      !d?.assignment ||
      !["draw", "live", "judging"].includes(d.stage) ||
      d.paused ||
      d.phaseId !== phaseId
    )
      throw new AppError("CONFLICT", "현재 내 그림 차례에서 올려주세요.");
  } else {
    if (
      view.phase !== "lobby" ||
      !view.clue ||
      (view.clue.settings.mode !== "member" && !view.isHost)
    )
      throw new AppError("FORBIDDEN", "단서각 대기실의 출제자만 자료를 올릴 수 있어요.");
    if (view.clue.settings.mode === "quiz" ? !["audio", "video"].includes(kind) : kind !== "photo")
      throw new AppError("VALIDATION", "선택한 모드에 맞는 사진 또는 소리·영상을 올려주세요.");
  }
}
export async function cleanupGameAssets(db: Database, now = new Date()) {
  return db.transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(gameAssets)
      .where(or(isNull(gameAssets.roomId), lte(gameAssets.expiresAt, now)))
      .limit(30)
      .for("update", { skipLocked: true });
    for (const a of expired) {
      const kind = a.kind === "photo" || a.kind === "drawing" ? "post" : "video";
      await enqueueObjectCleanup(
        tx,
        { kind, objectKey: a.objectKey, storageBackend: a.storageBackend },
        "game-expired",
      );
      if (a.sourceKey && a.sourceKey !== a.objectKey)
        await enqueueObjectCleanup(
          tx,
          { kind: "video", objectKey: a.sourceKey, storageBackend: a.storageBackend },
          "game-expired",
        );
      await tx.delete(gameAssets).where(eq(gameAssets.id, a.id));
    }
    await tx.delete(gameRuns).where(lte(gameRuns.expiresAt, now));
    // Set-null media parents are retained until their durable deletion jobs have been recorded.
    await tx
      .delete(gameRooms)
      .where(
        and(
          lte(gameRooms.expiresAt, now),
          sql`(${gameRooms.drawing} is not null or ${gameRooms.clue} is not null)`,
          sql`not exists (select 1 from sliper.game_assets ga where ga.room_id=${gameRooms.id})`,
        ),
      );
    return { processed: expired.length };
  });
}
