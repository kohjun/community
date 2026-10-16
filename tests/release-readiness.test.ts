import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import { memberSafety, staffRoles } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { releaseReadinessService } from "../src/server/release-readiness-service";
import { AppError } from "../src/server/errors";
import { eq } from "drizzle-orm";

const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let admin: string, moderator: string, member: string;
const errorCode = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  const profile = async (nickname: string) => {
    const id = randomUUID();
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({ id, nickname });
    return id;
  };
  admin = await profile("전환 점검 관리자");
  moderator = await profile("전환 점검 모더레이터");
  member = await profile("전환 점검 회원");
  await db.insert(staffRoles).values([
    { userId: admin, role: "admin" },
    { userId: moderator, role: "moderator" },
  ]);
});
after(() => pg.close());

test("release configuration reports require an active admin on every call including revoked, suspended and closed roles", async () => {
  const service = releaseReadinessService(connection, {});
  await assert.rejects(service.snapshot(null), errorCode("UNAUTHENTICATED"));
  for (const actor of [member, moderator, randomUUID()])
    await assert.rejects(service.snapshot(actor), errorCode("FORBIDDEN"));
  assert.equal((await service.snapshot(admin)).scope, "configuration-only");
  for (const status of ["suspended", "closed"]) {
    await db
      .insert(memberSafety)
      .values({ userId: admin, status })
      .onConflictDoUpdate({ target: memberSafety.userId, set: { status } });
    await assert.rejects(service.snapshot(admin), errorCode("FORBIDDEN"));
  }
  await db.delete(memberSafety).where(eq(memberSafety.userId, admin));
  await db.delete(staffRoles).where(eq(staffRoles.userId, admin));
  await assert.rejects(service.snapshot(admin), errorCode("FORBIDDEN"));
});

test("reports are redacted projections and cannot turn static format checks into connection or release approval", async () => {
  const secret = randomBytes(32).toString("hex"),
    environment = {
      NODE_ENV: "production",
      LOCAL_DATABASE: "1",
      SLIPER_AUTH_MODE: "development",
      APP_ORIGIN: "http://127.0.0.1:3000",
      VISITOR_HASH_SECRET: secret,
      NEXT_PUBLIC_UNRELATED: secret,
      DATABASE_URL: "postgresql://runtime:" + secret + "@127.0.0.1:55432/sliper_dev",
      SLIPER_ADSENSE_ENABLED: "true",
      SLIPER_ADSENSE_CLIENT_ID: "invalid-" + secret,
    },
    original = { ...environment },
    value = await releaseReadinessService(connection, environment).snapshot(admin);
  assert.deepEqual(environment, original);
  assert.equal(value.externalVerification, "not-performed");
  assert.equal(value.scope, "configuration-only");
  assert.ok(value.summary.fail > 0);
  assert.equal(value.summary.pass + value.summary.warn + value.summary.fail, value.checks.length);
  for (const status of ["pass", "warn", "fail"] as const)
    assert.equal(value.summary[status], value.checks.filter((row) => row.status === status).length);
  assert.ok(value.checks.some((row) => row.id === "advertising" && row.status === "fail"));
  assert.equal(JSON.stringify(value).includes(secret), false);
  assert.equal(JSON.stringify(value).includes(environment.DATABASE_URL), false);
  assert.deepEqual(
    Object.keys(value).sort(),
    ["checkedAt", "scope", "checks", "summary", "externalVerification"].sort(),
  );
  for (const row of value.checks)
    assert.deepEqual(Object.keys(row).sort(), ["id", "message", "status"]);
  assert.ok(Number.isFinite(Date.parse(value.checkedAt)));
});

test("configuration GET work never creates, drains or edits stored community, moderation, notification or cleanup rows", async () => {
  const snapshot = async () => {
    const tables = await pg.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='sliper' and table_type='BASE TABLE' order by table_name",
    );
    const rows: Record<string, unknown> = {};
    for (const { table_name } of tables.rows) {
      assert.match(table_name, /^[a-z_]+$/);
      rows[table_name] = (
        await pg.query(
          "select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from sliper.\"" +
            table_name +
            '" t',
        )
      ).rows;
    }
    return rows;
  };
  const before = await snapshot(),
    service = releaseReadinessService(connection, {});
  await service.snapshot(admin);
  await service.snapshot(admin);
  assert.deepEqual(await snapshot(), before);
});

test("configured integrations are never probed by the read-only report", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Remote requests are forbidden in a configuration report");
  };
  try {
    const value = await releaseReadinessService(connection, {
      NODE_ENV: "production",
      LOCAL_DATABASE: "0",
      SLIPER_AUTH_MODE: "supabase",
      APP_ORIGIN: "https://sliper-community.co.kr",
      NEXT_PUBLIC_SUPABASE_URL: "https://sliper-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "sb_publishable_" + randomBytes(24).toString("base64url"),
      DATABASE_URL:
        "postgresql://runtime:" +
        randomBytes(24).toString("hex") +
        "@sliper-db.supabase.co/postgres?sslmode=require",
      REDIS_URL: "rediss://sliper-cache.co.kr:6379",
      PAYMENT_PROVIDER: "bridge",
      PAYMENT_CHECKOUT_API_URL: "https://sliper-payments.co.kr/checkout",
      PAYMENT_API_KEY: randomBytes(24).toString("hex"),
      PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
      PAYMENT_CHECKOUT_ORIGINS: "https://sliper-payments.co.kr",
    }).snapshot(admin);
    assert.equal(value.externalVerification, "not-performed");
    assert.equal(requests, 0);
    assert.equal(value.checks.find((row) => row.id === "authentication")?.status, "pass");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
