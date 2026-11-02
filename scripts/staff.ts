import nextEnv from "@next/env";
import { inArray } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { staffRoles } from "../src/db/safety-schema";
import { loadLocalTestAccount, isLocalTestEnvironment } from "../src/server/local-test-auth";
import { changeStaffRole } from "./lib/staff-role-management";
const args = process.argv.slice(2);
const usage =
  "Usage: npm run staff:grant -- --public-id PROFILE_PUBLIC_UUID --role admin|moderator|none [--apply --expected-role none|moderator|admin --reason REASON]\nDefault is a read-only dry-run. Apply is allowed only from a trusted server terminal with MIGRATION_DATABASE_URL. No password or secret belongs in command arguments.";
if (args.includes("--help")) console.log(usage);
else {
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
    const allowed = new Set([
      "--public-id",
      "--role",
      "--expected-role",
      "--reason",
      "--apply",
      "--local-admin",
    ]);
    const options = new Map<string, string>();
    const flags = new Set<string>();
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (!allowed.has(key) || flags.has(key) || options.has(key))
        throw new Error("Invalid or duplicate option.");
      if (["--apply", "--local-admin"].includes(key)) flags.add(key);
      else {
        const value = args[++i];
        if (!value || value.startsWith("--")) throw new Error("Missing option value.");
        options.set(key, value);
      }
    }
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) throw new Error("MIGRATION_DATABASE_URL is required in a private environment file.");
    if (flags.has("--local-admin")) {
      if (args.length !== 1 || !isLocalTestEnvironment({ ...process.env, NODE_ENV: "development" }))
        throw new Error("Local admin setup requires the isolated development database.");
      const parsed = new URL(url);
      if (
        parsed.hostname !== "127.0.0.1" ||
        parsed.port !== "55432" ||
        parsed.pathname !== "/sliper_dev"
      )
        throw new Error("Not the isolated local database.");
      connection = createDatabase(url, 1);
      const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
      const ids = ["00000000-0000-4000-8000-000000000001", ...(account ? [account.userId] : [])];
      const existing = await connection.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(inArray(profiles.id, ids));
      for (const profile of existing)
        await connection.db
          .insert(staffRoles)
          .values({ userId: profile.id, role: "admin" })
          .onConflictDoUpdate({ target: staffRoles.userId, set: { role: "admin" } });
      console.log(JSON.stringify({ local: true, configured: existing.length }));
    } else {
      // Parse before connecting, so accidental empty commands never touch the DB.
      const { staffChangeSchema } = await import("./lib/staff-role-management");
      const input = staffChangeSchema.parse({
        publicId: options.get("--public-id"),
        role: options.get("--role"),
        expectedRole: options.get("--expected-role"),
        reason: options.get("--reason"),
        apply: flags.has("--apply"),
      });
      connection = createDatabase(url, 1);
      console.log(JSON.stringify(await changeStaffRole(connection.db, input)));
    }
  } catch (error) {
    const safe =
      error instanceof Error &&
      /^(Member not found|Only active|Role changed|Cannot remove|MIGRATION_DATABASE_URL|Local admin|Not the isolated|Invalid or duplicate|Missing option)/.test(
        error.message,
      );
    console.error(
      safe
        ? error.message
        : "Staff role setup failed. Check the profile public ID, options and DB permissions. Raw connection errors are suppressed.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.close();
  }
}
