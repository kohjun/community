import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { staffRoles } from "../src/db/safety-schema";
import { loadLocalTestAccount, isLocalTestEnvironment } from "../src/server/local-test-auth";
const args = process.argv.slice(2),
  local = args.includes("--local-admin");
const target = args[args.indexOf("--public-id") + 1],
  role = args[args.indexOf("--role") + 1];
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Migration database is required.");
const connection = createDatabase(url, 1);
try {
  let userIds: string[] = [];
  if (local) {
    if (!isLocalTestEnvironment({ ...process.env, NODE_ENV: "development" }))
      throw new Error("Local admin setup requires the isolated development database.");
    const parsed = new URL(url);
    if (
      parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "55432" ||
      parsed.pathname !== "/sliper_dev"
    )
      throw new Error("Not the local database.");
    const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
    userIds = ["00000000-0000-4000-8000-000000000001", ...(account ? [account.userId] : [])];
  } else {
    const publicId = z
      .string()
      .uuid()
      .parse(args.includes("--public-id") ? target : undefined);
    z.enum(["moderator", "admin"]).parse(args.includes("--role") ? role : undefined);
    const [profile] = await connection.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.publicId, publicId));
    if (!profile) throw new Error("Member not found.");
    userIds = [profile.id];
  }
  const existing = await connection.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  for (const profile of existing)
    await connection.db
      .insert(staffRoles)
      .values({
        userId: profile.id,
        role: local ? "admin" : z.enum(["moderator", "admin"]).parse(role),
      })
      .onConflictDoUpdate({
        target: staffRoles.userId,
        set: { role: local ? "admin" : z.enum(["moderator", "admin"]).parse(role) },
      });
  console.log("Sliper staff roles configured for " + existing.length + " member(s).");
} finally {
  await connection.close();
}
