import { processGameMedia } from "../src/server/game-media-worker";
import { cleanupGameAssets } from "../src/server/game-media-core";
import { workerHeartbeat } from "../src/server/worker-health";
import { config } from "dotenv";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "../src/db/connection";
import { imageStorageConfiguration } from "../src/server/image-storage-config";
import { videoProcessingStorage } from "../src/server/video-source-storage";
import { videoWorker } from "../src/server/video-processing-service";
import { compressVideo } from "../src/server/video-transcoding-core";
import { buildLogger, logSafeError } from "../src/server/logger";

config({ path: [".env.local", ".env"], quiet: true });
const logger = buildLogger({ service: "sliper-video-worker" });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const backend = imageStorageConfiguration().backend;
const connection = createDatabase(process.env.DATABASE_URL, 2);
const controller = new AbortController();
const heartbeat = process.argv.includes("--once") ? null : await workerHeartbeat("video");
const worker = videoWorker(connection.db, {
  storage: videoProcessingStorage(),
  transcode: compressVideo,
  derivativeBackend: backend,
});
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  if (process.argv.includes("--once")) {
    console.log(JSON.stringify(await worker.drain(controller.signal)));
  } else {
    logger.info({ concurrency: 1, backend }, "Sliper video worker ready.");
    let lastGameCleanup = 0;
    while (!controller.signal.aborted) {
      try {
        const result = await worker.drain(controller.signal);
        await heartbeat!.success();
        if (Date.now() - lastGameCleanup >= 60_000) {
          await cleanupGameAssets(connection.db);
          lastGameCleanup = Date.now();
        }
        const gameMedia = await processGameMedia(connection.db, controller.signal);
        if (result.processed || gameMedia.processed) continue;
      } catch (error) {
        // Credentials, source paths and private uploader IDs never enter logs.
        logSafeError(
          logger,
          "Sliper video worker: processing requires retry or lease recovery.",
          error,
        );
      }
      await delay(2000, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  }
} finally {
  await heartbeat?.stop();
  await connection.close();
}
