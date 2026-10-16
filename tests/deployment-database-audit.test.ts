import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  auditDeploymentDatabase,
  databaseAuditFailure,
  databaseAuditSql,
  databaseAuditTarget,
  readDatabaseAuditManifest,
  type DatabaseAuditManifest,
  type DatabaseAuditQuery,
  type DatabaseAuditReport,
  type DatabaseAuditScope,
} from "../scripts/lib/deployment-database-audit";

const pg = new PGlite();
const manifest = readDatabaseAuditManifest();
const runtime = "sliper_audit_runtime";
const row = (report: DatabaseAuditReport, id: string) =>
  report.checks.find((check) => check.id === id)!;
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  await pg.exec(`create role ${runtime} bypassrls;
    grant usage on schema sliper,drizzle to ${runtime};
    grant select,insert,update,delete on all tables in schema sliper to ${runtime};
    grant execute on all functions in schema sliper to ${runtime};
    grant select on drizzle.__drizzle_migrations to ${runtime};`);
});
after(() => pg.close());
async function inspect(
  expected: DatabaseAuditManifest = manifest,
  statements: string[] = [],
  scope: DatabaseAuditScope = "local-diagnostic",
) {
  await pg.exec(`begin isolation level repeatable read read only; set local role ${runtime};`);
  const query: DatabaseAuditQuery = async <Row extends Record<string, unknown>>(text: string) => {
    statements.push(text);
    return (await pg.query<Row>(text)).rows;
  };
  try {
    return await auditDeploymentDatabase(query, expected, scope);
  } finally {
    await pg.exec("rollback");
  }
}
test("manifest follows every checked-in migration and latest snapshot without hardcoded migration totals", () => {
  assert.ok(manifest.migrations.length > 60);
  assert.ok(manifest.tables.length > 70);
  assert.ok(manifest.functions.includes("member_has_host_responsibility"));
  assert.ok(manifest.functions.includes("search_tags"));
  assert.equal(new Set(manifest.tables).size, manifest.tables.length);
  assert.equal(new Set(manifest.functions).size, manifest.functions.length);
  for (const [index, migration] of manifest.migrations.entries()) {
    assert.match(migration.hash, /^[a-f0-9]{64}$/);
    if (index) assert.ok(migration.createdAt > manifest.migrations[index - 1]!.createdAt);
  }
  assert.throws(
    () => readDatabaseAuditManifest("not-a-real-workspace"),
    (error: unknown) => error instanceof Error && !error.message.includes("not-a-real-workspace"),
  );
});
test("target parsing separates local diagnostics from TLS-protected remote connections and never puts credentials in reports", () => {
  const secret = randomBytes(24).toString("hex");
  for (const host of [
    "127.0.0.1:55432",
    "localhost:5432",
    "192.168.0.2:5432",
    "[::1]:5432",
    "database.internal:5432",
  ]) {
    const target = databaseAuditTarget({
      DATABASE_URL: `postgresql://runtime:${secret}@${host}/sliper_dev`,
    });
    assert.equal(target.scope, "local-diagnostic");
    assert.ok(target.connectionString);
  }
  const remote = `postgresql://runtime:${secret}@db.project.supabase.co/postgres?sslmode=require`;
  assert.equal(databaseAuditTarget({ DATABASE_URL: remote }).scope, "remote-database-readonly");
  assert.equal(databaseAuditTarget({ DATABASE_URL: remote }).connectionString, remote);
  for (const DATABASE_URL of [
    undefined,
    "https://not-a-db.example",
    `postgresql://runtime:${secret}@db.project.supabase.co/postgres`,
    `postgresql://runtime:${secret}@db.project.supabase.co/postgres?sslmode=disable`,
    "postgresql://runtime:%ZZ@db.project.supabase.co/postgres?sslmode=require",
  ])
    assert.equal(databaseAuditTarget({ DATABASE_URL }).connectionString, null);
  const report = databaseAuditFailure("remote-database-readonly");
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.releaseApproval, "not-performed");
  assert.equal(report.summary.fail, 1);
});
test("catalog checks pass for a separate trusted runtime role without reading or changing application rows", async () => {
  const statements: string[] = [];
  const report = await inspect(manifest, statements);
  assert.equal(
    report.summary.fail,
    0,
    JSON.stringify(report.checks.filter((check) => check.status === "fail")),
  );
  assert.ok(report.summary.warn >= 1);
  assert.equal(report.scope, "local-diagnostic");
  assert.equal(report.releaseApproval, "not-performed");
  assert.equal(row(report, "target-environment").status, "warn");
  for (const statement of statements)
    assert.ok(
      Object.values(databaseAuditSql).includes(
        statement as (typeof databaseAuditSql)[keyof typeof databaseAuditSql],
      ) ||
        /^(?:savepoint|release savepoint|rollback to savepoint) sliper_migration_audit$/.test(
          statement,
        ),
    );
  assert.equal(JSON.stringify(report).includes(runtime), false);
  assert.equal(JSON.stringify(report).includes(manifest.migrations[0]!.hash), false);
  for (const check of report.checks)
    assert.deepEqual(Object.keys(check).sort(), ["id", "message", "status"]);
});
test("checks refuse to inspect permissions outside a read-only repeatable-read transaction", async () => {
  const queries: string[] = [];
  const query: DatabaseAuditQuery = async <Row extends Record<string, unknown>>(text: string) => {
    queries.push(text);
    return [{ readonly: false, repeatable: true }] as unknown as Row[];
  };
  const result = await auditDeploymentDatabase(query, manifest, "local-diagnostic");
  assert.equal(row(result, "transaction").status, "fail");
  assert.deepEqual(queries, [databaseAuditSql.transaction]);
});
test("a missing runtime table privilege is detected through actual PostgreSQL catalog functions", async () => {
  await pg.exec(`revoke update on sliper.posts from ${runtime}`);
  try {
    assert.equal(row(await inspect(), "table-access").status, "fail");
  } finally {
    await pg.exec(`grant update on sliper.posts to ${runtime}`);
  }
});
test("RLS enabled with no runtime bypass is not mistaken for working application access", async () => {
  await pg.exec(`alter role ${runtime} nobypassrls`);
  try {
    assert.equal(row(await inspect(), "row-security").status, "fail");
  } finally {
    await pg.exec(`alter role ${runtime} bypassrls`);
  }
});
test("owner role membership and administrative flags are detected independently of URL usernames", async () => {
  const [owner] = (await pg.query<{ current_user: string }>("select current_user")).rows;
  assert.ok(owner && /^[a-z_][a-z0-9_]*$/.test(owner.current_user));
  await pg.exec(
    `grant ${owner!.current_user} to ${runtime}; alter role ${runtime} createdb createrole replication`,
  );
  try {
    const report = await inspect();
    assert.equal(row(report, "owner-separation").status, "fail");
    assert.equal(row(report, "runtime-role").status, "fail");
  } finally {
    await pg.exec(
      `revoke ${owner!.current_user} from ${runtime}; alter role ${runtime} nocreatedb nocreaterole noreplication`,
    );
  }
});
test("browser column-only and inherited table privileges fail even if schema usage is separately denied", async () => {
  await pg.exec("grant select(title) on sliper.posts to anon");
  try {
    assert.equal(row(await inspect(), "browser-isolation").status, "fail");
  } finally {
    await pg.exec("revoke select(title) on sliper.posts from anon");
  }
  await pg.exec("grant select(body_markdown) on sliper.posts to public");
  try {
    assert.equal(row(await inspect(), "browser-isolation").status, "fail");
  } finally {
    await pg.exec("revoke select(body_markdown) on sliper.posts from public");
  }
  await pg.exec(
    "create role audit_browser_parent; grant select on sliper.posts to audit_browser_parent; grant audit_browser_parent to authenticated",
  );
  try {
    assert.equal(row(await inspect(), "browser-isolation").status, "fail");
  } finally {
    await pg.exec(
      "revoke audit_browser_parent from authenticated; revoke select on sliper.posts from audit_browser_parent; drop role audit_browser_parent",
    );
  }
});
test("pure explicit helper EXECUTE is a policy warning while sensitive or arbitrary immutable helpers fail", async () => {
  await pg.exec("grant execute on function sliper.search_tags(text[]) to public");
  try {
    const report = await inspect();
    assert.equal(row(report, "browser-isolation").status, "pass");
    assert.equal(row(report, "pure-helper-policy").status, "warn");
  } finally {
    await pg.exec("revoke execute on function sliper.search_tags(text[]) from public");
  }
  await pg.exec("grant execute on function sliper.member_has_host_responsibility(uuid) to anon");
  try {
    assert.equal(row(await inspect(), "browser-isolation").status, "fail");
  } finally {
    await pg.exec(
      "revoke execute on function sliper.member_has_host_responsibility(uuid) from anon",
    );
  }
  await pg.exec(
    `create function sliper.audit_unknown_immutable() returns text language sql immutable as $$select 'fixture'::text$$; grant execute on function sliper.audit_unknown_immutable() to public,${runtime}`,
  );
  try {
    assert.equal(row(await inspect(), "browser-isolation").status, "fail");
  } finally {
    await pg.exec("drop function sliper.audit_unknown_immutable()");
  }
});
test("missing expected tables and functions and runtime helper EXECUTE cannot pass", async () => {
  assert.equal(
    row(
      await inspect({ ...manifest, tables: [...manifest.tables, "audit_missing_table"] }),
      "table-inventory",
    ).status,
    "fail",
  );
  assert.equal(
    row(
      await inspect({ ...manifest, functions: [...manifest.functions, "audit_missing_function"] }),
      "function-access",
    ).status,
    "fail",
  );
  await pg.exec(
    `revoke execute on function sliper.member_has_host_responsibility(uuid) from ${runtime}`,
  );
  try {
    assert.equal(row(await inspect(), "function-access").status, "fail");
  } finally {
    await pg.exec(
      `grant execute on function sliper.member_has_host_responsibility(uuid) to ${runtime}`,
    );
  }
});
test("migration verification compares every hash and position rather than latest timestamp or count", async () => {
  const first = manifest.migrations[0]!;
  for (const migrations of [
    manifest.migrations.slice(1),
    [{ ...first, hash: randomBytes(32).toString("hex") }, ...manifest.migrations.slice(1)],
    [...manifest.migrations].reverse(),
    [{ ...first, createdAt: first.createdAt + 1 }, ...manifest.migrations.slice(1)],
  ])
    assert.equal(row(await inspect({ ...manifest, migrations }), "migrations").status, "fail");
});
test("unreadable migration journal remains a redacted failed check and its savepoint clears transaction failure", async () => {
  await pg.exec(`revoke select on drizzle.__drizzle_migrations from ${runtime}`);
  try {
    const report = await inspect();
    assert.equal(row(report, "migrations").status, "fail");
    assert.equal(row(report, "table-access").status, "pass");
    assert.equal(JSON.stringify(report).includes(runtime), false);
    assert.doesNotMatch(JSON.stringify(report), /permission denied|SQLSTATE|postgresql:\/\//i);
  } finally {
    await pg.exec(`grant select on drizzle.__drizzle_migrations to ${runtime}`);
  }
});

test("explicit environment files never fall back to an existing local DATABASE_URL, and help never loads or connects", () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "sliper-db-audit-"));
  const file = path.join(folder, "isolated.env");
  const sentinel = randomBytes(24).toString("hex");
  writeFileSync(file, "DATABASE_URL=\nUNUSED_PRIVATE_SETTING=" + sentinel + "\n");
  const cli = (arguments_: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/deploy-db-check.ts", "--", ...arguments_],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 8000,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://fallback:" + sentinel + "@127.0.0.1:1/sliper_dev",
        },
      },
    );
  try {
    for (const environmentFile of [file, path.join(folder, "missing.env")]) {
      const child = cli(["--env-file", environmentFile, "--json", "--strict"]);
      assert.equal(child.status, 1);
      assert.equal(child.stderr, "");
      const report = JSON.parse(child.stdout) as DatabaseAuditReport;
      assert.equal(report.scope, "unconfigured");
      assert.equal(report.summary.fail, 1);
      for (const forbidden of [sentinel, folder, "127.0.0.1", "fallback"])
        assert.equal(child.stdout.includes(forbidden), false);
    }
    const help = cli(["--env-file", path.join(folder, "missing.env"), "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.doesNotMatch(help.stdout, /checkedAt|database-connection/);
    const bad = cli(["--env-file"]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Usage:/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("remote scope cannot pass when the observed DB session is unencrypted", async () => {
  const report = await inspect(manifest, [], "remote-database-readonly");
  assert.equal(row(report, "transport-security").status, "fail");
  assert.equal(report.releaseApproval, "not-performed");
});
