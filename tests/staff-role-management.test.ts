import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { memberSafety, moderationAudit, staffRoles } from "../src/db/safety-schema";
import { changeStaffRole, staffChangeSchema } from "../scripts/lib/staff-role-management";
test("staff bootstrap defaults to dry-run and apply requires a target, expected role and reason", () => {
  const base = { publicId: randomUUID(), role: "admin" };
  assert.equal(staffChangeSchema.parse(base).apply, false);
  assert.equal(staffChangeSchema.safeParse({ ...base, apply: true }).success, false);
  assert.equal(
    staffChangeSchema.safeParse({
      ...base,
      apply: true,
      expectedRole: "none",
      reason: "본인 계정 운영 관리자 지정",
    }).success,
    true,
  );
  assert.equal(staffChangeSchema.safeParse({ ...base, publicId: "*" }).success, false);
});
test("staff role changes are explicit, auditable, idempotent and cannot lock out the last active admin", async () => {
  const pg = new PGlite(),
    raw = drizzle(pg),
    db = raw as unknown as Database;
  try {
    await pg.exec(
      "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
    );
    await migrate(raw, { migrationsFolder: "./drizzle" });
    // PGlite serializes transactions and doesn't model advisory concurrency. Real PG uses the built-in lock.
    await pg.exec(
      "create function pg_advisory_xact_lock(integer,integer) returns void language sql as 'select';",
    );
    const id = randomUUID(),
      second = randomUUID(),
      publicId = randomUUID(),
      secondPublic = randomUUID();
    for (const value of [id, second]) await pg.query("insert into auth.users values($1)", [value]);
    await raw.insert(profiles).values([
      { id, publicId, nickname: "운영 검증" },
      { id: second, publicId: secondPublic, nickname: "보조 검증" },
    ]);
    const plan = await changeStaffRole(db, { publicId, role: "admin" });
    assert.equal(plan.applied, false);
    assert.equal((await raw.select().from(staffRoles)).length, 0);
    const input = {
      publicId,
      role: "admin",
      apply: true,
      expectedRole: "none",
      reason: "본인 소유 계정을 관리자로 지정",
    };
    assert.equal((await changeStaffRole(db, input)).applied, true);
    assert.equal((await raw.select().from(moderationAudit)).length, 1);
    assert.equal((await changeStaffRole(db, { ...input, expectedRole: "admin" })).applied, false);
    assert.equal((await raw.select().from(moderationAudit)).length, 1);
    await assert.rejects(changeStaffRole(db, input), /Role changed/);
    await assert.rejects(
      changeStaffRole(db, { ...input, expectedRole: "admin", role: "none" }),
      /last active/,
    );
    await changeStaffRole(db, { ...input, publicId: secondPublic });
    await changeStaffRole(db, { ...input, expectedRole: "admin", role: "moderator" });
    assert.equal(
      (await raw.select().from(staffRoles).where(eq(staffRoles.userId, id)))[0]!.role,
      "moderator",
    );
    await raw.insert(memberSafety).values({ userId: id, status: "closed" });
    await assert.rejects(
      changeStaffRole(db, { ...input, expectedRole: "moderator" }),
      /Only active/,
    );
    assert.equal((await raw.select().from(moderationAudit)).length, 3);
  } finally {
    await pg.close();
  }
});
