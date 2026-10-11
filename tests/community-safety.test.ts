import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as safety from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { membershipActive } from "../src/domain/safety";
import { authConfiguration } from "../src/server/auth-config";
import { safetyService } from "../src/server/safety-service";
import { communityService } from "../src/server/community-service";
import { enforceRequestLimit } from "../src/server/request-limits";
import { assertContentVisible } from "../src/server/safety-visibility";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...safety } }),
  connection = db as unknown as Database;
const service = safetyService(connection),
  community = communityService(connection);
let owner: string, reader: string, admin: string, mod: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(name: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname: name });
  return id;
}
async function post(anonymous = true) {
  return community.createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "게임 후기",
    bodyMarkdown: "즐거웠던 행사 후기입니다.",
    isAnonymous: anonymous,
    imageAssetIds: [],
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("작성자");
  reader = await member("참가자");
  admin = await member("운영자");
  mod = await member("검토자");
  await db.insert(safety.staffRoles).values([
    { userId: admin, role: "admin" },
    { userId: mod, role: "moderator" },
  ]);
});
after(() => pg.close());
test("real authentication configuration is disabled for a local or insecure deployment", () => {
  const env = {
    SLIPER_AUTH_MODE: "supabase",
    LOCAL_DATABASE: "0",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
    APP_ORIGIN: "https://sliper.example",
  };
  assert.ok(authConfiguration(env));
  assert.equal(authConfiguration({ ...env, LOCAL_DATABASE: "1" }), null);
  assert.equal(authConfiguration({ ...env, APP_ORIGIN: "http://192.168.1.4:3000" }), null);
  assert.equal(authConfiguration({ ...env, SLIPER_AUTH_MODE: "development" }), null);
  assert.equal(authConfiguration({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }), null);
});
test("membership checks expire temporary restrictions but never reopen a closed account", () => {
  const now = new Date();
  assert.equal(membershipActive(undefined, now), true);
  assert.equal(
    membershipActive({ status: "suspended", suspendedUntil: new Date(now.getTime() + 1000) }, now),
    false,
  );
  assert.equal(
    membershipActive({ status: "suspended", suspendedUntil: new Date(now.getTime() - 1000) }, now),
    true,
  );
  assert.equal(membershipActive({ status: "closed", suspendedUntil: new Date(0) }, now), false);
});
test("reports deduplicate and public responses never reveal a private author or reporter ID", async () => {
  const target = await post(),
    report = await service.report(reader, {
      targetType: "post",
      targetId: target.id,
      reason: "spam",
      detail: "반복 광고가 보여요.",
    });
  assert.equal(report.status, "open");
  assert.equal("snapshot" in report, false);
  assert.equal(JSON.stringify(report).includes(owner), false);
  assert.equal(JSON.stringify(report).includes(reader), false);
  await assert.rejects(
    service.report(reader, { targetType: "post", targetId: target.id, reason: "spam" }),
    code("CONFLICT"),
  );
  assert.equal((await service.reports(owner)).items.length, 0);
  await assert.rejects(
    service.report(owner, { targetType: "post", targetId: target.id, reason: "other" }),
    code("VALIDATION"),
  );
});
test("moderation is authorized, records a reason, hides all feed projections, and restores without deleting data", async () => {
  const target = await post(),
    report = await service.report(reader, {
      targetType: "post",
      targetId: target.id,
      reason: "privacy",
    });
  await assert.rejects(service.reports(reader, true), code("FORBIDDEN"));
  await assert.rejects(
    service.resolve(reader, report.id, { action: "hide", reason: "개인정보 노출 확인" }),
    code("FORBIDDEN"),
  );
  await service.resolve(mod, report.id, { action: "hide", reason: "개인정보 노출 확인" });
  assert.equal((await community.feed(null)).posts.length, 0);
  assert.equal((await community.highlights(null)).hot.length, 0);
  await assert.rejects(community.getPost(target.id, null), code("NOT_FOUND"));
  await assert.rejects(assertContentVisible(connection, "post", target.id), code("NOT_FOUND"));
  const [original] = await db.select().from(base.posts).where(eq(base.posts.id, target.id));
  assert.equal(original?.status, "published");
  assert.ok(original?.bodyMarkdown);
  assert.equal((await service.reports(reader)).items[0]?.resolution, "개인정보 노출 확인");
  await service.resolve(mod, report.id, {
    action: "restore",
    reason: "개인정보가 아닌 것으로 확인",
  });
  assert.equal((await community.feed(null)).posts.length, 1);
  assert.equal((await service.audit(admin)).items.length, 2);
});
test("anonymous blocks use an opaque block ID and hide content only from the blocking member", async () => {
  const target = await post(),
    block = await service.block(reader, { targetType: "post", targetId: target.id });
  assert.equal(block.label, "익명 사용자");
  assert.equal(JSON.stringify(await service.blocks(reader)).includes(owner), false);
  assert.equal((await community.feed(reader)).posts.length, 0);
  assert.equal((await community.feed(null)).posts.length, 1);
  await assert.rejects(service.unblock(owner, block.id), code("NOT_FOUND"));
  await service.unblock(reader, block.id);
  assert.equal((await community.feed(reader)).posts.length, 1);
});
test("hidden comments preserve reply structure while concealing body and author", async () => {
  const target = await post(),
    { comment } = await community.createComment(owner, {
      postId: target.id,
      bodyMarkdown: "숨겨야 할 내용",
      isAnonymous: true,
    });
  const { comment: reply } = await community.createComment(reader, {
    postId: target.id,
    parentId: comment.id,
    bodyMarkdown: "답글 내용",
    isAnonymous: false,
  });
  const report = await service.report(reader, {
    targetType: "comment",
    targetId: comment.id,
    reason: "harassment",
  });
  await service.resolve(admin, report.id, { action: "hide", reason: "괴롭힘 표현으로 확인" });
  const comments = await community.commentPage(target.id, reader);
  assert.equal(comments.items[0]?.isDeleted, true);
  assert.equal(comments.items[0]?.body.includes("숨겨야"), false);
  assert.equal(
    (await community.commentPage(target.id, reader, { parentId: comment.id })).items[0]?.id,
    reply.id,
  );
});
test("only an administrator can clear a suspension and staff cannot suspend other staff", async () => {
  const target = await post(),
    report = await service.report(reader, {
      targetType: "post",
      targetId: target.id,
      reason: "fraud",
    });
  await service.resolve(mod, report.id, {
    action: "suspend",
    reason: "허위 모집으로 확인",
    days: 7,
  });
  await assert.rejects(service.activeMember(owner), code("FORBIDDEN"));
  const [profile] = await db.select().from(base.profiles).where(eq(base.profiles.id, owner));
  await assert.rejects(
    service.reinstate(mod, profile!.publicId, "이의신청 검토 후 해제"),
    code("FORBIDDEN"),
  );
  await service.reinstate(admin, profile!.publicId, "이의신청 검토 후 해제");
  assert.equal(await service.activeMember(owner), owner);
});
test("support messages and staff replies are visible only to their owner and authorized staff", async () => {
  const ticket = await service.createTicket(reader, {
    category: "payment",
    subject: "결제 확인 요청",
    body: "결제 이후 참가 확인이 되지 않았어요.",
  });
  assert.equal((await service.tickets(owner)).items.length, 0);
  await assert.rejects(
    service.reply(owner, ticket!.id, { body: "답변 사칭입니다." }),
    code("FORBIDDEN"),
  );
  await service.reply(admin, ticket!.id, {
    body: "담당자에게 주문 확인을 요청했어요.",
    close: false,
  });
  const own = (await service.tickets(reader)).items[0];
  assert.equal(own?.replies.length, 1);
  assert.equal(own?.status, "answered");
  assert.equal("userId" in own!, false);
});
test("request limits cannot be bypassed by parallel requests or reset by subsequent denied attempts", async () => {
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, () => enforceRequestLimit(connection, reader, "test", 3)),
  );
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 3);
  await assert.rejects(enforceRequestLimit(connection, reader, "test", 3), code("RATE_LIMITED"));
});
test("withdrawal removes personal profile and device information and prevents reactivation", async () => {
  const target = await post(false);
  await service.withdraw(owner);
  const [profile] = await db.select().from(base.profiles).where(eq(base.profiles.id, owner));
  assert.equal(profile?.nickname, "탈퇴한 회원");
  assert.equal(profile?.phoneNumber, null);
  assert.equal((await service.account(owner)).status, "closed");
  await assert.rejects(service.activeMember(owner), code("FORBIDDEN"));
  assert.equal((await community.getPost(target.id, null)).author, "탈퇴한 회원");
  await assert.rejects(
    service.reinstate(admin, profile!.publicId, "실수로 삭제한 계정 복원"),
    code("CONFLICT"),
  );
});
test("a member with a future confirmed event cannot withdraw and lose event contact information", async () => {
  const target = await post();
  await db.update(base.posts).set({ kind: "모집" }).where(eq(base.posts.id, target.id));
  await db.insert(base.eventSettings).values({
    postId: target.id,
    amountKRW: 0,
    capacity: 5,
    startsAt: new Date(Date.now() + 86400000),
  });
  await db.insert(base.eventApplications).values({
    postId: target.id,
    userId: reader,
    attendeeName: "참가자",
    contact: "01012345678",
    amountKRW: 0,
    status: "confirmed",
    confirmedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  await assert.rejects(service.withdraw(reader), code("CONFLICT"));
  await assert.rejects(service.withdraw(owner), code("CONFLICT"));
});
test("public database roles cannot access raw reports or staff roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    await pg.exec("set role " + role);
    try {
      await assert.rejects(pg.query("select * from sliper.safety_reports"));
      await assert.rejects(pg.query("select * from sliper.staff_roles"));
    } finally {
      await pg.exec("reset role");
    }
  }
});
test("withdrawal after an event preserves immutable application records", async () => {
  const target = await post();
  await db.update(base.posts).set({ kind: "모집" }).where(eq(base.posts.id, target.id));
  await db.insert(base.eventSettings).values({
    postId: target.id,
    amountKRW: 0,
    capacity: 5,
    startsAt: new Date(Date.now() - 86400000),
  });
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId: target.id,
      userId: reader,
      attendeeName: "참가자",
      contact: "01012345678",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 1800000),
    })
    .returning();
  await service.withdraw(reader);
  const [record] = await db
    .select()
    .from(base.eventApplications)
    .where(eq(base.eventApplications.id, application!.id));
  assert.equal(record?.contact, "01012345678");
  assert.equal((await service.account(reader)).status, "closed");
});
test("an anonymous-author restriction can be lifted from the report without exposing their identity", async () => {
  const target = await post(),
    report = await service.report(reader, {
      targetType: "post",
      targetId: target.id,
      reason: "fraud",
    });
  await service.resolve(mod, report.id, {
    action: "suspend",
    reason: "참가자 이의사항 확인",
    days: 7,
  });
  await assert.rejects(
    service.resolve(mod, report.id, { action: "reinstate", reason: "이의신청 검토 후 해제" }),
    code("FORBIDDEN"),
  );
  await service.resolve(admin, report.id, { action: "reinstate", reason: "이의신청 검토 후 해제" });
  assert.equal(await service.activeMember(owner), owner);
  assert.equal(JSON.stringify((await service.reports(reader)).items).includes(owner), false);
});
