import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { gameAssets } from "../db/game-room-schema";
import { videoProcessingStorage } from "./video-source-storage";
import { persistManagedImage } from "./image-persistence";
import { enqueueObjectCleanup } from "./object-cleanup-service";
import { transcodeGameClue } from "./game-media-transcoding";
export async function processGameMedia(db: Database, signal: AbortSignal) {
  const now = new Date(),
    token = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(gameAssets)
      .where(
        and(
          sql`${gameAssets.kind} in ('audio','video')`,
          gt(gameAssets.expiresAt, now),
          sql`${gameAssets.attempts}<3`,
          or(
            eq(gameAssets.status, "queued"),
            and(eq(gameAssets.status, "processing"), lte(gameAssets.leaseExpiresAt, now)),
          ),
        ),
      )
      .orderBy(gameAssets.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx
      .update(gameAssets)
      .set({
        status: "processing",
        lockToken: token,
        leaseExpiresAt: new Date(now.getTime() + 120_000),
        attempts: row.attempts + 1,
      })
      .where(eq(gameAssets.id, row.id));
    return row;
  });
  if (!claim) return { processed: 0 };
  const store = videoProcessingStorage().derivatives(claim.storageBackend);
  try {
    const source = await store.read("video", claim.sourceKey ?? claim.objectKey);
    const output = await transcodeGameClue(source, claim.kind === "audio", signal),
      objectKey = `${randomUUID()}.mp4`;
    await persistManagedImage(db, store, "video", objectKey, output, async (tx) => {
      const changed = await tx
        .update(gameAssets)
        .set({
          status: "ready",
          objectKey,
          sourceKey: null,
          byteSize: output.byteLength,
          contentType: claim.kind === "audio" ? "audio/mp4" : "video/mp4",
          lockToken: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(gameAssets.id, claim.id),
            eq(gameAssets.lockToken, token),
            gt(gameAssets.expiresAt, new Date()),
          ),
        )
        .returning({ id: gameAssets.id });
      if (!changed.length) throw new Error("STALE_GAME_MEDIA_LEASE");
      await enqueueObjectCleanup(
        tx,
        {
          kind: "video",
          storageBackend: claim.storageBackend,
          objectKey: claim.sourceKey ?? claim.objectKey,
        },
        "upload-rollback",
      );
    });
  } catch {
    await db
      .update(gameAssets)
      .set({
        status: claim.attempts + 1 >= 3 ? "failed" : "queued",
        lockToken: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(gameAssets.id, claim.id), eq(gameAssets.lockToken, token)));
  }
  return { processed: 1 };
}
