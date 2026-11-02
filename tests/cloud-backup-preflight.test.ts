import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  backupPreflightReport,
  cloudBackupConfiguration,
  pgToolMajor,
  restoreTargetInventory,
  sourceBackupInventory,
  supabaseProjectReference,
  type BackupEnvironment,
} from "../scripts/lib/cloud-backup-preflight";
const source = "a".repeat(20),
  target = "b".repeat(20);
function env(): BackupEnvironment {
  const password = randomBytes(20).toString("hex");
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${source}.supabase.co`,
    SUPABASE_STORAGE_URL: `https://${source}.supabase.co`,
    SUPABASE_STORAGE_BUCKET: "sliper-private-images",
    SUPABASE_STORAGE_SECRET_KEY: randomBytes(30).toString("hex"),
    DATABASE_URL: `postgresql://sliper_app.${source}:${password}@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require`,
    BACKUP_DATABASE_URL: `postgresql://postgres.${source}:${password}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require`,
  };
}
test("backup configuration accepts same-project runtime/session connections and a distinct empty-project target identity", () => {
  const e = env(),
    c = cloudBackupConfiguration(e);
  assert.equal(c.source, e.DATABASE_URL);
  assert.equal(c.dump, e.BACKUP_DATABASE_URL);
  assert.equal(c.restore, null);
  assert.equal(
    cloudBackupConfiguration({ ...e, DATABASE_URL: e.DATABASE_URL + "&max_pipeline=1" }).source,
    e.DATABASE_URL + "&max_pipeline=1",
  );
  const distinct = {
    ...e,
    BACKUP_RESTORE_PROJECT_URL: `https://${target}.supabase.co`,
    BACKUP_RESTORE_DATABASE_URL: e.BACKUP_DATABASE_URL!.replaceAll(source, target),
  };
  assert.equal(cloudBackupConfiguration(distinct).restore, distinct.BACKUP_RESTORE_DATABASE_URL);
  assert.equal(supabaseProjectReference(e.NEXT_PUBLIC_SUPABASE_URL), source);
});
test("restore isolation rejects the source through direct/pooler aliases, target mismatch, unsafe TLS and transaction-mode dumps", () => {
  const e = env();
  for (const change of [
    {
      BACKUP_RESTORE_PROJECT_URL: e.NEXT_PUBLIC_SUPABASE_URL,
      BACKUP_RESTORE_DATABASE_URL: `postgresql://postgres:${randomBytes(20).toString("hex")}@db.${source}.supabase.co:5432/postgres?sslmode=require`,
    },
    {
      BACKUP_RESTORE_PROJECT_URL: `https://${target}.supabase.co`,
      BACKUP_RESTORE_DATABASE_URL: e.BACKUP_DATABASE_URL,
    },
    { BACKUP_DATABASE_URL: e.DATABASE_URL },
    { DATABASE_URL: e.DATABASE_URL!.replace("sslmode=require", "sslmode=disable") },
    { DATABASE_URL: e.DATABASE_URL! + "&options=unsafe" },
    { DATABASE_URL: e.DATABASE_URL!.replace(source, target) },
    { SUPABASE_STORAGE_URL: `https://${target}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${source}.supabase.co/elsewhere` },
  ])
    assert.throws(
      () => cloudBackupConfiguration({ ...e, ...change }),
      /CLOUD_BACKUP_CONFIGURATION_INVALID/,
    );
});
test("version checks parse actual native output and never accept arbitrary command errors", () => {
  assert.equal(pgToolMajor("pg_dump (PostgreSQL) 18.0", "pg_dump"), 18);
  assert.equal(pgToolMajor("pg_restore (PostgreSQL) 17.6 (Ubuntu 17.6-1)", "pg_restore"), 17);
  assert.throws(
    () => pgToolMajor("a private error with pg_dump 18 inside", "pg_dump"),
    /PG_TOOL_UNAVAILABLE/,
  );
  assert.throws(() => pgToolMajor("pg_restore (PostgreSQL) 18.0", "pg_dump"));
});
const pg = new PGlite(),
  db = drizzle(pg);
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
after(async () => {
  await pg.close();
});
test("migration-backed inventory reports counts and capacity without object keys or profile data and refuses a writable transaction", async () => {
  const user = randomUUID(),
    photo = randomUUID();
  await pg.query("insert into auth.users values($1)", [user]);
  await pg.query("insert into sliper.profiles(id,nickname)values($1,$2)", [
    user,
    "private-fixture-name",
  ]);
  await pg.query(
    "insert into sliper.profile_photos(id,user_id,object_key,storage_backend,content_type,bytes)values($1,$2,$3,'supabase','image/webp',300)",
    [photo, user, photo + ".webp"],
  );
  for (const [status, backend, size] of [
    ["ready", "supabase", 100],
    ["ready", "local", 50],
    ["pending", "supabase", 999],
  ] as const)
    await pg.query(
      "insert into sliper.media_assets(object_key,content_type,byte_size,status,storage_backend,uploader_id)values($1,'image/webp',$2,$3,$4,$5)",
      [randomUUID() + ".webp", size, status, backend, user],
    );
  const inventory = await pg.transaction(async (tx) => {
    await tx.exec("set transaction isolation level repeatable read read only");
    return sourceBackupInventory(
      async (text) => (await tx.query<Record<string, unknown>>(text)).rows,
    );
  });
  assert.equal(inventory.expectedReferencedObjects, 3);
  assert.equal(inventory.expectedReferencedBytes, 450);
  assert.equal(inventory.localReferences, 1);
  assert.ok(inventory.appTables >= 87);
  assert.ok(inventory.appliedMigrations >= 74);
  assert.equal(inventory.storageObjectBytesVerified, false);
  for (const value of [user, photo, "private-fixture-name", "object_key"])
    assert.equal(JSON.stringify(inventory).includes(value), false);
  await assert.rejects(
    sourceBackupInventory(async (text) => (await pg.query<Record<string, unknown>>(text)).rows),
    /BACKUP_INVENTORY_FAILED/,
  );
});
test("restore preflight refuses nonempty application/Auth targets without any write statement", async () => {
  const statements: string[] = [];
  const result = await restoreTargetInventory(async (text) => {
    statements.push(text);
    return [{ readonly: "on", row_security: "off", tables: "0", users: "0" }];
  });
  assert.equal(result.emptyApplication, true);
  assert.equal(
    (
      await restoreTargetInventory(async () => [
        { readonly: "on", row_security: "off", tables: "0", users: "1" },
      ])
    ).emptyApplication,
    false,
  );
  const existing = await pg.transaction(async (tx) => {
    await tx.exec("set transaction read only");
    return restoreTargetInventory(
      async (text) => (await tx.query<Record<string, unknown>>(text)).rows,
    );
  });
  assert.equal(existing.emptyApplication, false);
  assert.equal(statements[0], "set local row_security=off");
  assert.ok(
    statements.every((text) => text.startsWith("select ") || text === "set local row_security=off"),
  );
});
test("RLS-filtered Auth users cannot make a used restore target appear empty", async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(
      "create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('d051e77a-f62c-45db-b04d-19ed3740b091');alter table auth.users enable row level security;create role restore_probe;grant usage on schema auth to restore_probe;grant select on auth.users to restore_probe;",
    );
    const falselyEmpty = await isolated.transaction(async (tx) => {
      await tx.exec("set transaction read only;set local role restore_probe");
      return (await tx.query<{ count: string }>("select count(*)::text as count from auth.users"))
        .rows[0]!.count;
    });
    assert.equal(falselyEmpty, "0");
    await assert.rejects(
      isolated.transaction(async (tx) => {
        await tx.exec("set transaction read only;set local role restore_probe");
        return restoreTargetInventory(
          async (text) => (await tx.query<Record<string, unknown>>(text)).rows,
        );
      }),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "42501",
    );
  } finally {
    await isolated.close();
  }
});
test("report distinguishes readiness from actual backup, restore, downloads and worker delivery", () => {
  const report = backupPreflightReport([
    { id: "capture", status: "warn", message: "Not performed" },
    { id: "read-only", status: "pass", message: "Verified" },
  ]);
  assert.deepEqual(report.summary, { pass: 1, warn: 1, fail: 0 });
  assert.equal(report.backupCreated, false);
  assert.equal(report.restorePerformed, false);
  assert.equal(report.objectsDownloaded, false);
  assert.equal(report.deliveryWorkersStarted, false);
});
