import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createDatabase, type Database } from "../db/connection";
import { gameAssets } from "../db/game-room-schema";
import type { DrawingState } from "../domain/creative-games";
import { inkCommand, replayInk } from "../domain/game-ink";
import { gameInkRedis } from "./game-ink-runtime";
import { imageObjectStore } from "./image-storage";
import { enqueueObjectCleanup } from "./object-cleanup-service";
export type FinalizeDrawing = (
  tx: Database,
  roomId: string,
  state: DrawingState,
  owners: Record<string, string>,
  expiresAt: Date,
  stage: "draw" | "live" | "judging",
) => Promise<boolean>;
// Independent intent connection avoids waiting for the room pool while its row is locked.
const intentGlobal = globalThis as unknown as {
  sliperDrawingIntentConnection?: ReturnType<typeof createDatabase>;
};
function intentDatabase() {
  if (!intentGlobal.sliperDrawingIntentConnection) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required.");
    intentGlobal.sliperDrawingIntentConnection = createDatabase(url, 1);
  }
  return intentGlobal.sliperDrawingIntentConnection.db;
}
export function drawingFinalizer(durableDatabase?: Database): FinalizeDrawing {
  return async (tx, roomId, s, owners, expiresAt, stage) => {
    if (!s.runId) return false;
    let changed = false;
    const redis = await gameInkRedis().catch(() => null);
    if (!redis) return false;
    const targets = stage === "draw" ? s.chains : s.chains.slice(s.index, s.index + 1);
    await Promise.all(
      targets.map(async (chain) => {
        const first = stage === "draw",
          field = first ? "image" : "finalImage",
          owner = owners[first ? chain.painter : chain.finalPainter];
        if (chain[field] || !owner) return;
        try {
          const events = await redis.store.events(
            roomId,
            `${s.runId}:${s.set}:${chain.id}:${first ? "first" : "final"}`,
          );
          const valid = events.map((e) => ({ seq: e.seq, command: inkCommand.parse(e.command) }));
          const strokes = replayInk(valid);
          if (!strokes.some((p) => p.points.length)) return;
          const paths = strokes
            .map((p) =>
              p.points.length === 1
                ? `<circle cx="${p.points[0]![0] * 800}" cy="${p.points[0]![1] * 600}" r="${p.width / 2}" fill="${p.colour}"/>`
                : `<polyline points="${p.points.map(([x, y]) => `${x * 800},${y * 600}`).join(" ")}" fill="none" stroke="${p.colour}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
            )
            .join("");
          const bytes = await sharp(
            Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/>${paths}</svg>`,
            ),
          )
            .webp({ quality: 85 })
            .toBuffer();
          const store = imageObjectStore(),
            id = randomUUID(),
            objectKey = `${randomUUID()}.webp`;
          // This intent commits outside the room transaction. A crash cannot orphan a stored draft.
          await enqueueObjectCleanup(
            durableDatabase ?? intentDatabase(),
            { kind: "post", objectKey, storageBackend: store.backend },
            "upload-rollback",
            3600000,
          );
          await store.write("post", objectKey, bytes);
          await tx.insert(gameAssets).values({
            id,
            roomId,
            runId: s.runId,
            uploaderHash: owner,
            phaseId: s.phaseId,
            kind: "drawing",
            status: "ready",
            storageBackend: store.backend,
            objectKey,
            contentType: "image/webp",
            byteSize: bytes.byteLength,
            expiresAt,
          });
          chain[field] = id;
          changed = true;
        } catch {
          /* Missing drafts are explicitly skipped by the game rules; transient storage never stalls the whole room. */
        }
      }),
    );
    return changed;
  };
}
