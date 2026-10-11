import "dotenv/config";
import postgres from "postgres";

const url = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
) {
  throw new Error("Bootstrap only supports the isolated local Sliper database.");
}
url.pathname = "/postgres";
const admin = postgres(url.toString(), { max: 1 });
try {
  const exists = await admin`select 1 from pg_database where datname = 'sliper_dev'`;
  if (!exists.length) await admin.unsafe("CREATE DATABASE sliper_dev");
} finally {
  await admin.end();
}
url.pathname = "/sliper_dev";
const db = postgres(url.toString(), { max: 1 });
try {
  await db.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);`);
  console.log(
    "Local database bootstrapped. Supabase-managed auth is simulated only in this isolated database.",
  );
} finally {
  await db.end();
}
