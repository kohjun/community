import "dotenv/config";
import { createDatabase } from "../src/db/connection";
import { mediaRetentionService } from "../src/server/media-retention-service";
import { imageObjectStore } from "../src/server/image-storage";
import { verifyLocalRetentionPath } from "../src/server/media-retention-local";
let connection: ReturnType<typeof createDatabase> | undefined;
try {
  const args = process.argv.slice(2);
  if (
    new Set(args).size !== args.length ||
    args.some((a) => !["--apply", "--dry-run"].includes(a)) ||
    (args.includes("--apply") && args.includes("--dry-run"))
  )
    throw new Error("Invalid command options");
  if (!process.env.DATABASE_URL) throw new Error("Missing server configuration");
  connection = createDatabase(process.env.DATABASE_URL, 1);
  const service = mediaRetentionService(connection.db);
  if (args.includes("--apply")) {
    const result = await service.drain(async (kind, backend, key) => {
      if (backend === "local") await verifyLocalRetentionPath(kind, key);
      await imageObjectStore(backend).remove(kind === "image" ? "post" : "video", key);
    });
    console.log(JSON.stringify({ mode: "apply", ...result }));
  } else console.log(JSON.stringify({ mode: "dry-run", ...(await service.summary()) }));
} catch {
  console.error(
    "Sliper media retention: unable to complete the requested check. No private values are logged.",
  );
  process.exitCode = 1;
} finally {
  await connection?.close();
}
