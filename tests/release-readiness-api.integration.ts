import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { memberSafety, staffRoles } from "../src/db/safety-schema";
import type { ActionResult } from "../src/domain/contracts";
import type { ReleaseReadiness } from "../src/domain/release-readiness";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  loadLocalTestAccount,
} from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000";
function localDatabase() {
  try {
    const address = new URL(process.env.DATABASE_URL ?? "");
    if (
      process.env.LOCAL_DATABASE !== "1" ||
      process.env.SLIPER_AUTH_MODE !== "development" ||
      process.env.APP_ORIGIN !== origin ||
      !["postgres:", "postgresql:"].includes(address.protocol) ||
      address.hostname !== "127.0.0.1" ||
      address.port !== "55432" ||
      address.pathname !== "/sliper_dev"
    )
      throw new Error();
    return address;
  } catch {
    throw new Error("Readiness HTTP checks require the isolated local development database.");
  }
}
const address = localDatabase();
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("The existing local test account is required for readiness HTTP checks.");
const actor = account.userId;
const cookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host);
const guest = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
const apiPath = "/api/safety/admin/readiness";
const pagePath = "/admin/readiness";
type Reply<T> = { status: number; result: ActionResult<T> };
async function api<T>(path = apiPath, session = cookie): Promise<Reply<T>> {
  const response = await fetch(origin + path, {
    headers: { Origin: origin, Cookie: session },
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function successful<T>(reply: Reply<T>): T {
  assert.equal(reply.status, 200, "The readiness fixture request must succeed.");
  assert.ok(reply.result.ok, "The readiness handler must return success.");
  return reply.result.data;
}
function denied(reply: Reply<unknown>, status: number, code: string) {
  assert.equal(reply.status, status);
  assert.equal(reply.result.ok, false);
  if (!reply.result.ok) assert.equal(reply.result.error.code, code);
  assert.equal(JSON.stringify(reply.result).includes("READINESS-PRIVATE-"), false);
}
async function page(session = cookie) {
  const response = await fetch(origin + pagePath, {
    headers: { Cookie: session },
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, html: await response.text() };
}
function privateProjection(data: unknown) {
  const text = JSON.stringify(data);
  assert.doesNotMatch(
    text,
    /READINESS-PRIVATE-|(?:postgres(?:ql)?|rediss?):\/\/[a-zA-Z0-9[._-]|https?:\/\/[a-zA-Z0-9[._-]|ca-pub-\d{16}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
  );
  // Compare values only in memory. Never print settings, credentials or account identifiers.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !value ||
      value.length < 12 ||
      !/DATABASE_URL|APP_ORIGIN|SUPABASE.*(?:URL|KEY)|REDIS_URL|VISITOR_HASH_SECRET|VAPID_.*KEY|PAYMENT_.*(?:KEY|SECRET)|APPROVAL_.*SECRET|ADSENSE.*(?:CLIENT|SLOT|PUBLISHER)/.test(
        key,
      )
    )
      continue;
    assert.equal(text.includes(value), false, "A runtime setting value must not be exposed.");
  }
}
function validSnapshot(snapshot: ReleaseReadiness) {
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "checkedAt",
    "checks",
    "externalVerification",
    "scope",
    "summary",
  ]);
  assert.ok(Number.isFinite(Date.parse(snapshot.checkedAt)));
  assert.equal(snapshot.scope, "configuration-only");
  assert.equal(snapshot.externalVerification, "not-performed");
  assert.ok(snapshot.checks.length > 0);
  const counts = { pass: 0, warn: 0, fail: 0 };
  const ids = new Set<string>();
  for (const check of snapshot.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["id", "message", "status"]);
    assert.match(check.id, /^[a-z][a-z-]*$/);
    assert.equal(ids.has(check.id), false);
    ids.add(check.id);
    assert.ok(["pass", "warn", "fail"].includes(check.status));
    assert.equal(typeof check.message, "string");
    assert.ok(check.message.length > 0);
    counts[check.status]++;
  }
  assert.ok(ids.has("authentication") && ids.has("image-storage") && ids.has("advertising"));
  assert.deepEqual(snapshot.summary, counts);
  privateProjection(snapshot);
}

test("HTTP readiness: active-admin-only redacted configuration report, live revocation, read-only projection and private SSR", async () => {
  const connection = createDatabase(address.href, 1);
  const db = connection.db;
  let captured = false;
  type FixtureBackup = {
    role: Record<string, unknown> | null;
    state: Record<string, unknown> | null;
  };
  let original: FixtureBackup | undefined;
  async function backupRows(): Promise<FixtureBackup> {
    const [backup] = await db.execute<FixtureBackup>(sql`select
      (select to_jsonb(r) from sliper.staff_roles r where r.user_id=${actor}::uuid) as role,
      (select to_jsonb(s) from sliper.member_safety s where s.user_id=${actor}::uuid) as state`);
    if (!backup) throw new Error("The readiness fixture backup could not be captured.");
    return backup;
  }
  const digest = (backup: FixtureBackup) =>
    createHash("sha256").update(JSON.stringify(backup)).digest("hex");
  async function role(value: "admin" | "moderator" | null) {
    await db.transaction(async (tx) => {
      await tx.delete(staffRoles).where(eq(staffRoles.userId, actor));
      if (value) await tx.insert(staffRoles).values({ userId: actor, role: value });
    });
  }
  async function state(value: "active" | "suspended" | "closed") {
    const update = {
      status: value,
      reason: "READINESS-PRIVATE-INTERNAL-ACCOUNT-NOTE",
      suspendedUntil: value === "suspended" ? new Date(Date.now() + 86400000) : null,
      updatedAt: new Date(),
    };
    await db
      .insert(memberSafety)
      .values({ userId: actor, ...update })
      .onConflictDoUpdate({ target: memberSafety.userId, set: update });
  }
  async function fixtureDigest() {
    return digest(await backupRows());
  }
  function genericOnly(rendered: { status: number; html: string }) {
    assert.equal(rendered.status, 200);
    assert.match(rendered.html, /관리자 권한이 있는 계정으로 로그인해주세요/);
    assert.doesNotMatch(rendered.html, /설정 형식 확인 결과|실제 운영 검증|READINESS-PRIVATE-/);
  }
  try {
    assert.equal(
      successful(await api<{ authenticated: boolean }>("/api/auth/test/session")).authenticated,
      true,
    );
    original = await backupRows();
    captured = true;
    denied(await api(apiPath, guest), 401, "UNAUTHENTICATED");
    genericOnly(await page(guest));
    await state("active");
    await role(null);
    denied(await api(), 403, "FORBIDDEN");
    denied(await api(apiPath + "?environment=production"), 403, "FORBIDDEN");
    genericOnly(await page());
    await role("moderator");
    denied(await api(), 403, "FORBIDDEN");
    await role("admin");
    const beforeReads = await fixtureDigest();
    validSnapshot(successful(await api<ReleaseReadiness>()));
    for (const query of ["unknown=true", "probe=true", "environment=production", "page=1&page=2"])
      denied(await api(apiPath + "?" + query), 400, "VALIDATION");
    const report = await page();
    assert.equal(report.status, 200);
    assert.match(report.html, /설정 형식 확인 결과/);
    assert.match(report.html, /외부 검증은 수행하지 않았어요/);
    assert.match(report.html, /형식 확인됨|추가 확인|설정 보완/);
    assert.doesNotMatch(
      report.html,
      /READINESS-PRIVATE-|출시 가능|<ins[^>]*adsbygoogle|<script[^>]*src=["'][^"']*pagead2[.]googlesyndication[.]com/i,
    );
    const unsupported = await fetch(origin + apiPath, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ probe: true }),
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(unsupported.status, 405);
    await unsupported.arrayBuffer();
    assert.equal(
      await fixtureDigest(),
      beforeReads,
      "Configuration reads must not change membership or staff state.",
    );
    await role(null);
    denied(await api(), 403, "FORBIDDEN");
    genericOnly(await page());
    await role("admin");
    for (const restricted of ["suspended", "closed"] as const) {
      await state(restricted);
      const response = await api();
      assert.ok([401, 403].includes(response.status));
      assert.equal(response.result.ok, false);
      privateProjection(response.result);
      genericOnly(await page());
    }
  } finally {
    try {
      if (captured && original) {
        const saved = original;
        await db.transaction(async (tx) => {
          await tx.delete(staffRoles).where(eq(staffRoles.userId, actor));
          await tx.delete(memberSafety).where(eq(memberSafety.userId, actor));
          if (saved.state)
            await tx.execute(
              sql`insert into sliper.member_safety select (jsonb_populate_record(null::sliper.member_safety, ${JSON.stringify(saved.state)}::jsonb)).*`,
            );
          if (saved.role)
            await tx.execute(
              sql`insert into sliper.staff_roles select (jsonb_populate_record(null::sliper.staff_roles, ${JSON.stringify(saved.role)}::jsonb)).*`,
            );
        });
        assert.equal(
          await fixtureDigest(),
          digest(saved),
          "The exact original membership and staff rows must be restored.",
        );
      }
    } finally {
      await connection.close();
    }
  }
});
