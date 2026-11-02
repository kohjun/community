import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { objectCleanupJobs } from "../src/db/object-cleanup-schema";
import { objectCleanupService } from "../src/server/object-cleanup-service";
import { removeCleanupObject } from "../src/server/object-cleanup-runtime";
config({ path: [".env.local", ".env"], quiet: true });
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--retry-failed"))
  throw new Error("Usage: npm run object:cleanup -- [--retry-failed]");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const connection = createDatabase(process.env.DATABASE_URL, 2);
try {
  if (args.includes("--retry-failed"))
    await connection.db
      .update(objectCleanupJobs)
      .set({ status: "pending", attempts: 0, availableAt: new Date(), errorCode: null })
      .where(eq(objectCleanupJobs.status, "failed"));
  console.log(
    JSON.stringify(await objectCleanupService(connection.db, removeCleanupObject).drain(20)),
  );
} catch {
  console.error("Object cleanup could not be completed; durable jobs remain for retry.");
  process.exitCode = 1;
} finally {
  await connection.close();
}
