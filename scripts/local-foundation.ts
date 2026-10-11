import "dotenv/config";
for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const value = process.env[key];
  if (!value) throw new Error("Local database connection missing.");
  const url = new URL(value);
  if (
    process.env.LOCAL_DATABASE !== "1" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/sliper_dev"
  )
    throw new Error(
      "This migration helper only operates on the isolated Sliper development database.",
    );
}
await import("./migrate");
