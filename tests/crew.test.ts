import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as crewSchema from "../src/db/crew-schema";
import {
  memberSafety,
  contentRestrictions,
  memberBlocks,
  staffRoles,
} from "../src/db/safety-schema";
import { eventAdmissions } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { eventLifecycle } from "../src/db/event-lifecycle-schema";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { crewInputSchema, crewJoinSchema, crewUpdateSchema } from "../src/domain/crew";
import { crewService } from "../src/server/crew-service";
import { safetyService } from "../src/server/safety-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...schema, ...crewSchema } }),
  database = db as unknown as Database;
const service = crewService(database),
  safety = safetyService(database);
const input = {
  name: "예능 제작 크루",
  description: "매주 함께 예능 모임을 만드는 크루입니다.",
  category: "party" as const,
  capacity: 20,
};
const consent = { message: "진행 스태프로 함께하고 싶어요.", publicNameConsent: true };
let owner: string,
  member: string,
  other: string,
  ownerPublic: string,
  memberPublic: string,
  otherPublic: string;
const code = (value: string) => (error: unknown) =>
  error instanceof AppError && error.code === value;
async function profile(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  const [row] = await db
    .insert(schema.profiles)
    .values({ id, nickname, phoneNumber: "01012345678" })
    .returning({ publicId: schema.profiles.publicId });
  return { id, publicId: row!.publicId };
}
async function join(crewId: string, user = member) {
  await service.join(user, crewId, consent);
  const request = (await service.detail(user, crewId)).myRequest!;
  await service.decide(owner, crewId, { requestId: request.id, approve: true });
  return request;
}
async function event(host = owner, options: { sample?: boolean; future?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(schema.posts).values({
    id,
    categorySlug: "party",
    authorId: host,
    title: "실제 참가한 크루 행사",
    kind: "모집",
    sample: options.sample ?? false,
    bodyMarkdown: "행사 내용",
  });
  await db.insert(schema.eventSettings).values({
    postId: id,
    amountKRW: 0,
    capacity: 20,
    open: true,
    startsAt: new Date(options.future ? "2099-01-01T01:00:00Z" : "2020-01-01T01:00:00Z"),
    endsAt: new Date(options.future ? "2099-01-01T03:00:00Z" : "2020-01-01T03:00:00Z"),
  });
  return id;
}
async function attendance(postId: string, user = member, qr = true, attended = true) {
  const id = randomUUID();
  await db.insert(schema.eventApplications).values({
    id,
    postId,
    userId: user,
    attendeeName: "참가자",
    contact: "private-phone",
    amountKRW: 0,
    status: "confirmed",
    confirmedAt: new Date(),
    eventStartsAt: new Date("2020-01-01T01:00:00Z"),
    refundConsentAt: new Date(),
    expiresAt: new Date(Date.now() + 1800000),
  });
  if (qr)
    await db.insert(eventAdmissions).values({
      applicationId: id,
      postId,
      userId: user,
      checkedBy: owner === user ? other : owner,
      checkedAt: new Date("2020-01-01T02:00:00Z"),
    });
  if (attended)
    await db.insert(eventResults).values({
      applicationId: id,
      postId,
      userId: user,
      presence: "attended",
      recorderId: owner === user ? other : owner,
    });
  return id;
}
const contribution = (postId: string, publicId = memberPublic) => ({
  postId,
  memberPublicId: publicId,
  role: "진행 스태프",
  note: "현장 미션 진행",
});
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  const a = await profile("크루리더"),
    b = await profile("스태프멤버"),
    c = await profile("다른회원");
  owner = a.id;
  ownerPublic = a.publicId;
  member = b.id;
  memberPublic = b.publicId;
  other = c.id;
  otherPublic = c.publicId;
});
after(() => pg.close());
test("crew input bounds and disclosure consent reject forged roles and malformed content", () => {
  assert.ok(crewInputSchema.safeParse(input).success);
  for (const patch of [
    { ownerId: randomUUID() },
    { capacity: 101 },
    { name: "x" },
    { description: "short" },
    { name: "a\u0000b" },
  ])
    assert.equal(crewInputSchema.safeParse({ ...input, ...patch }).success, false);
  assert.equal(crewJoinSchema.safeParse({ ...consent, publicNameConsent: false }).success, false);
  assert.ok(crewInputSchema.safeParse({ ...input, name: "슬리퍼 😎" }).success);
});
test("only active authenticated profiles can create crews", async () => {
  await assert.rejects(service.create(null, input), code("UNAUTHENTICATED"));
  await db
    .insert(memberSafety)
    .values({ userId: owner, status: "suspended", suspendedUntil: new Date("2099-01-01") });
  await assert.rejects(service.create(owner, input), code("FORBIDDEN"));
});
test("public crew presentation excludes account identity, phone and private join message", async () => {
  const crew = await service.create(owner, input);
  await service.join(member, crew.id, { ...consent, message: "private application note" });
  const view = await service.detail(null, crew.id),
    serialized = JSON.stringify(view);
  assert.equal(view.memberCount, 1);
  assert.equal(view.members[0]?.publicId, ownerPublic);
  assert.equal(view.members[0]?.role, "owner");
  for (const value of [owner, member, other, "01012345678", "private application note"])
    assert.equal(serialized.includes(value), false);
  assert.equal(view.requests, null);
  assert.equal(view.myRequest, null);
  assert.equal(
    (await service.requests(owner, crew.id)).items[0]?.message,
    "private application note",
  );
  await assert.rejects(service.requests(other, crew.id), code("FORBIDDEN"));
});
test("duplicate pending requests conflict and withdrawal permits a fresh application", async () => {
  const crew = await service.create(owner, input);
  await service.join(member, crew.id, consent);
  await assert.rejects(service.join(member, crew.id, consent), code("CONFLICT"));
  const withdrawn = await service.withdrawRequest(member, crew.id);
  assert.equal(withdrawn.myRequest?.status, "withdrawn");
  await service.join(member, crew.id, consent);
  const request = (await service.detail(member, crew.id)).myRequest!;
  const approved = await service.decide(owner, crew.id, { requestId: request.id, approve: true });
  assert.equal(approved.memberCount, 2);
  await assert.rejects(
    service.decide(owner, crew.id, { requestId: request.id, approve: true }),
    code("CONFLICT"),
  );
  await assert.rejects(service.join(member, crew.id, consent), code("CONFLICT"));
});
test("parallel approvals respect crew capacity and leave failed requests pending", async () => {
  const crew = await service.create(owner, { ...input, capacity: 2 });
  await service.join(member, crew.id, consent);
  await service.join(other, crew.id, consent);
  const requests = (await service.requests(owner, crew.id)).items;
  const results = await Promise.allSettled(
    requests.map((request) =>
      service.decide(owner, crew.id, { requestId: request.id, approve: true }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await service.detail(owner, crew.id)).memberCount, 2);
  assert.equal((await service.requests(owner, crew.id)).total, 1);
});
test("managers can update and announce but cannot elevate roles, remove or archive", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  await service.setRole(owner, crew.id, { memberPublicId: memberPublic, role: "manager" });
  const current = await service.detail(member, crew.id);
  const updated = await service.update(member, crew.id, {
    ...input,
    name: "새 이름 크루",
    expectedUpdatedAt: current.updatedAt,
  });
  assert.equal(updated.name, "새 이름 크루");
  const notice = await service.announce(member, crew.id, { body: "**다음 모임 안내**" });
  assert.equal(notice.activity.items[0]?.kind, "announcement");
  for (const action of [
    () => service.setRole(member, crew.id, { memberPublicId: ownerPublic, role: "member" }),
    () => service.removeMember(member, crew.id, { memberPublicId: ownerPublic }),
    () => service.transfer(member, crew.id, { memberPublicId: ownerPublic }),
    () => service.archive(member, crew.id),
  ])
    await assert.rejects(action(), code("FORBIDDEN"));
  await assert.rejects(
    service.setRole(owner, crew.id, { memberPublicId: member, role: "manager" }),
    code("NOT_FOUND"),
  );
});
test("precise revisions reject stale edits and capacity cannot shrink below members", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  await join(crew.id, other);
  await assert.rejects(
    service.update(owner, crew.id, { ...input, expectedUpdatedAt: crew.updatedAt }),
    code("CONFLICT"),
  );
  const fresh = await service.detail(owner, crew.id);
  assert.match(fresh.updatedAt, /\.\d{6}Z$/);
  const truncatedRevision = new Date(fresh.updatedAt).toISOString();
  assert.equal(
    crewUpdateSchema.safeParse({ ...input, expectedUpdatedAt: truncatedRevision }).success,
    false,
  );
  await assert.rejects(
    service.update(owner, crew.id, { ...input, expectedUpdatedAt: truncatedRevision }),
  );
  await assert.rejects(
    service.update(owner, crew.id, { ...input, capacity: 2, expectedUpdatedAt: fresh.updatedAt }),
    code("CONFLICT"),
  );
});
test("ownership transfer is limited to an existing member and preserves one leader", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  await assert.rejects(
    service.transfer(owner, crew.id, { memberPublicId: otherPublic }),
    code("CONFLICT"),
  );
  await assert.rejects(service.leave(owner, crew.id), code("CONFLICT"));
  const transferred = await service.transfer(owner, crew.id, { memberPublicId: memberPublic });
  assert.equal(transferred.myRole, "manager");
  assert.equal(transferred.members.filter((m) => m.role === "owner").length, 1);
  assert.equal((await service.detail(member, crew.id)).myRole, "owner");
  const left = await service.leave(owner, crew.id);
  assert.equal(left.myRole, null);
  assert.equal(left.memberCount, 1);
});
test("archived crews retain history while refusing writes and leaving the public feed", async () => {
  const crew = await service.create(owner, input);
  await service.join(member, crew.id, consent);
  const archived = await service.archive(owner, crew.id);
  assert.equal(archived.archived, true);
  assert.equal(archived.requests?.total, 0);
  assert.equal((await service.list(null)).total, 0);
  assert.equal((await service.list(owner, { mine: "1" })).total, 1);
  await assert.rejects(service.join(other, crew.id, consent), code("CONFLICT"));
  await assert.rejects(service.announce(owner, crew.id, { body: "글" }), code("CONFLICT"));
});
test("hidden and blocked crews cannot leak detail or accept changes", async () => {
  const crew = await service.create(owner, input);
  await db
    .insert(memberBlocks)
    .values({ blockerId: member, blockedId: owner, displayLabel: "크루 리더" });
  await assert.rejects(service.detail(member, crew.id), code("NOT_FOUND"));
  assert.equal((await service.list(member)).total, 0);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "crew", targetId: crew.id, hidden: true, reason: "운영 검토" });
  await assert.rejects(service.detail(null, crew.id), code("NOT_FOUND"));
  await assert.rejects(service.announce(owner, crew.id, { body: "글" }), code("NOT_FOUND"));
});
test("crew report and moderation use the existing content safety queue", async () => {
  const crew = await service.create(owner, input);
  await db.insert(staffRoles).values({ userId: other, role: "moderator" });
  const report = await safety.report(member, {
    targetType: "crew",
    targetId: crew.id,
    reason: "spam",
  });
  assert.equal(report.targetType, "crew");
  await safety.resolve(other, report.id, { action: "hide", reason: "크루 안내 검토" });
  await assert.rejects(service.detail(null, crew.id), code("NOT_FOUND"));
  await safety.resolve(other, report.id, { action: "restore", reason: "크루 안내 확인" });
  assert.equal((await service.detail(null, crew.id)).id, crew.id);
});
test("only crew managers with actual event responsibility may link events", async () => {
  const crew = await service.create(owner, input),
    mine = await event(),
    foreign = await event(other);
  await assert.rejects(service.linkEvent(owner, crew.id, { postId: foreign }), code("FORBIDDEN"));
  await service.linkEvent(owner, crew.id, { postId: mine });
  await assert.rejects(service.linkEvent(owner, crew.id, { postId: mine }), code("CONFLICT"));
  await join(crew.id);
  await service.setRole(owner, crew.id, { memberPublicId: memberPublic, role: "manager" });
  await db.insert(schema.roomManagers).values({ postId: foreign, userId: member });
  await service.linkEvent(member, crew.id, { postId: foreign });
  assert.equal((await service.detail(null, crew.id)).events.length, 2);
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: other, displayLabel: "차단 회원" });
  const blockedEvents = await service.detail(owner, crew.id);
  assert.equal(blockedEvents.events.length, 1);
  assert.equal(blockedEvents.eventCount, 1);
  await db
    .delete(memberBlocks)
    .where(and(eq(memberBlocks.blockerId, owner), eq(memberBlocks.blockedId, other)));
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: mine, hidden: true, reason: "운영 검토" });
  const visible = await service.detail(null, crew.id);
  assert.equal(visible.events.length, 1);
  assert.equal(visible.eventCount, 1);
  await service.unlinkEvent(owner, crew.id, foreign);
  assert.equal((await service.detail(null, crew.id)).events.length, 0);
});
test("contribution requires attendance, QR, ended real event, other-member confirmation", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  const post = await event();
  await service.linkEvent(owner, crew.id, { postId: post });
  await assert.rejects(
    service.verifyContribution(owner, crew.id, contribution(post)),
    code("CONFLICT"),
  );
  const application = await attendance(post, member, false, true);
  await assert.rejects(
    service.verifyContribution(owner, crew.id, contribution(post)),
    code("CONFLICT"),
  );
  await db
    .insert(eventAdmissions)
    .values({ applicationId: application, postId: post, userId: member, checkedBy: owner });
  await assert.rejects(
    service.verifyContribution(member, crew.id, contribution(post)),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.verifyContribution(other, crew.id, contribution(post)),
    code("FORBIDDEN"),
  );
  const verified = await service.verifyContribution(owner, crew.id, contribution(post));
  assert.equal(verified.contributions.total, 1);
  await assert.rejects(
    service.verifyContribution(owner, crew.id, contribution(post)),
    code("CONFLICT"),
  );
  await assert.rejects(service.unlinkEvent(owner, crew.id, post), code("CONFLICT"));
  const [points] = await db
    .select({ total: sql<number>`sum(${schema.activityEvents.points})::int` })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.userId, member), eq(schema.activityEvents.reason, "crew")));
  assert.equal(points?.total, 5);
});
test("samples, future and cancelled events cannot generate verified contributions", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  for (const option of [{ sample: true }, { future: true }]) {
    const post = await event(owner, option);
    await service.linkEvent(owner, crew.id, { postId: post });
    await attendance(post);
    await assert.rejects(
      service.verifyContribution(owner, crew.id, contribution(post)),
      code("CONFLICT"),
    );
  }
  const cancelledPost = await event(owner, { future: true });
  await service.linkEvent(owner, crew.id, { postId: cancelledPost });
  await eventLifecycleService(database).change(owner, cancelledPost, {
    kind: "cancel",
    confirmed: true,
    expectedRevision: 0,
    reason: "주최자 행사 취소",
  });
  const [cancelled] = await db
    .select()
    .from(eventLifecycle)
    .where(eq(eventLifecycle.postId, cancelledPost));
  assert.ok(cancelled?.cancelledAt);
  const afterDate = crewService(database, () => new Date("2100-01-01T00:00:00Z"));
  await assert.rejects(
    afterDate.verifyContribution(owner, crew.id, contribution(cancelledPost)),
    code("CONFLICT"),
  );
  assert.equal((await service.detail(owner, crew.id)).contributions.total, 0);
});
test("one event gives one activity reward across multiple crews and daily rewards cap at ten", async () => {
  const a = await service.create(owner, input),
    b = await service.create(owner, { ...input, name: "두 번째 크루" });
  await join(a.id);
  await join(b.id);
  for (let index = 0; index < 3; index++) {
    const post = await event();
    await attendance(post);
    await service.linkEvent(owner, a.id, { postId: post });
    await service.verifyContribution(owner, a.id, contribution(post));
    if (index === 0) {
      await service.linkEvent(owner, b.id, { postId: post });
      await service.verifyContribution(owner, b.id, contribution(post));
    }
  }
  const [points] = await db
    .select({ total: sql<number>`sum(${schema.activityEvents.points})::int` })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.userId, member), eq(schema.activityEvents.reason, "crew")));
  assert.equal(points?.total, 10);
  assert.equal((await service.detail(owner, a.id)).contributions.total, 3);
});
test("contribution database identity constraints reject another member's admission", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  const post = await event();
  await service.linkEvent(owner, crew.id, { postId: post });
  const application = await attendance(post);
  await assert.rejects(
    db.insert(crewSchema.crewContributions).values({
      crewId: crew.id,
      postId: post,
      userId: other,
      applicationId: application,
      role: "MC",
      checkedBy: owner,
    }),
  );
});
test("public activity uses bounded pages and approval messages remain private", async () => {
  const crew = await service.create(owner, input);
  for (let i = 0; i < 25; i++) await service.announce(owner, crew.id, { body: "모임 안내 " + i });
  const first = await service.activity(null, crew.id),
    second = await service.activity(null, crew.id, { page: 2 });
  assert.equal(first.items.length, 20);
  assert.equal(first.nextPage, 2);
  assert.equal(second.items.length, 6);
  assert.equal(second.nextPage, null);
  assert.equal(new Set([...first.items, ...second.items].map((a) => a.id)).size, 26);
});
test("account withdrawal requires ownership handoff and then removes membership and requests", async () => {
  const crew = await service.create(owner, input);
  await join(crew.id);
  await assert.rejects(safety.withdraw(owner), code("CONFLICT"));
  await service.transfer(owner, crew.id, { memberPublicId: memberPublic });
  const result = await safety.withdraw(owner);
  assert.equal(result.withdrawn, true);
  assert.equal((await service.detail(member, crew.id)).memberCount, 1);
  const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, owner));
  assert.equal(state?.status, "closed");
  await assert.rejects(service.create(owner, input), code("FORBIDDEN"));
});
test("account withdrawal clears pending request notes and archived ownership is permitted", async () => {
  const crew = await service.create(owner, input);
  await service.join(member, crew.id, { ...consent, message: "private application" });
  await safety.withdraw(member);
  assert.equal((await service.requests(owner, crew.id)).total, 0);
  const [request] = await db
    .select()
    .from(crewSchema.crewJoinRequests)
    .where(eq(crewSchema.crewJoinRequests.userId, member));
  assert.equal(request?.message, "회원 탈퇴");
  await service.archive(owner, crew.id);
  await safety.withdraw(owner);
});
test("suspended applicants cannot be approved or receive contribution credit", async () => {
  const crew = await service.create(owner, input);
  await service.join(member, crew.id, consent);
  const request = (await service.detail(member, crew.id)).myRequest!;
  await db.insert(memberSafety).values({ userId: member, status: "closed" });
  await assert.rejects(
    service.decide(owner, crew.id, { requestId: request.id, approve: true }),
    code("FORBIDDEN"),
  );
  assert.equal((await service.detail(owner, crew.id)).memberCount, 1);
});
