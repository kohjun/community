import { config } from "dotenv";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "../src/db/connection";
import { imageStorageConfiguration } from "../src/server/image-storage-config";
import { videoProcessingStorage } from "../src/server/video-source-storage";
import { videoWorker } from "../src/server/video-processing-service";
import { compressVideo } from "../src/server/video-transcoding-core";

config({ path: [".env.local", ".env"], quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const backend = imageStorageConfiguration().backend;
const connection = createDatabase(process.env.DATABASE_URL, 2);
const controller = new AbortController();
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
    console.log("Sliper video worker ready (concurrency: 1).");
    while (!controller.signal.aborted) {
      try {
        const result = await worker.drain(controller.signal);
        if (result.processed) continue;
      } catch {
        // Credentials, source paths and private uploader IDs never enter logs.
        console.error("Sliper video worker: processing requires retry or lease recovery.");
      }
      await delay(2000, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  }
} finally {
  await connection.close();
}
