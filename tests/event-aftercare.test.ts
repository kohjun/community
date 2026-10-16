import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { eventCredits } from "../src/db/records-schema";
import { eventAdmissions, verifiedEventReviews } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { eventLifecycle, eventChanges } from "../src/db/event-lifecycle-schema";
import { memberSafety, memberBlocks, contentRestrictions } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { aftercareQuerySchema } from "../src/domain/event-aftercare";
import { eventAftercareService } from "../src/server/event-aftercare-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg),
  service = eventAftercareService(db as unknown as Database);
const ended = new Date("2020-01-01T03:00:00Z");
let host: string, manager: string, viewer: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
async function event(
  options: {
    owner?: string;
    completed?: boolean;
    status?: "draft" | "published" | "withdrawn";
    endsAt?: Date | null;
    sample?: boolean;
    title?: string;
  } = {},
) {
  const owner = options.owner ?? host;
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: options.title ?? "나의 행사 제목",
      bodyMarkdown: "참가 신청 답변이나 원문은 후속 작업 DTO에 포함하지 않습니다.",
      sample: options.sample ?? false,
    })
    .returning();
  const id = post!.id;
  await db.insert(base.eventSettings).values({
    postId: id,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: options.endsAt === undefined ? ended : options.endsAt,
    amountKRW: 0,
    capacity: 20,
    open: false,
    completedAt: options.completed ? ended : null,
    completedBy: options.completed ? owner : null,
  });
  if (options.completed)
    await db.insert(base.eventRecords).values({
      postId: id,
      ownerId: owner,
      completedAt: ended,
      status: options.status ?? "draft",
      snapshot: {
        title: "행사 당시 제목",
        category: "mind-games",
        location: "당시 장소",
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: ended.toISOString(),
        hostNickname: "주최자의 당시 닉네임",
        hostPublicId: randomUUID(),
        template: null,
      },
    });
  return id;
}
async function attend(
  postId: string,
  user: string,
  options: {
    qr?: boolean;
    result?: "attended" | "no_show";
    status?: "confirmed" | "refunded" | "cancelled";
    review?: boolean;
  } = {},
) {
  await db
    .update(base.eventSettings)
    .set({ open: true })
    .where(eq(base.eventSettings.postId, postId));
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: user,
      attendeeName: "비공개 신청자",
      contact: "test-" + randomUUID(),
      answers: [
        {
          questionId: randomUUID(),
          prompt: "비공개 질문",
          type: "text",
          options: [],
          answer: "비공개 응답",
        },
      ],
      note: "비공개 참가 요청사항",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: ended,
      expiresAt: ended,
    })
    .returning();
  if (options.qr)
    await db
      .insert(eventAdmissions)
      .values({ applicationId: application!.id, postId, userId: user, checkedBy: host });
  if (options.result)
    await db.insert(eventResults).values({
      applicationId: application!.id,
      postId,
      userId: user,
      recorderId: host,
      presence: options.result,
    });
  if (options.review) {
    const [post] = await db
      .insert(base.posts)
      .values({
        authorId: user,
        kind: "후기",
        categorySlug: "party",
        title: "이미 작성한 후기",
        bodyMarkdown: "작성한 후기입니다.",
      })
      .returning();
    await db.insert(verifiedEventReviews).values({
      reviewPostId: post!.id,
      eventPostId: postId,
      applicationId: application!.id,
      userId: user,
      hostId: host,
      eventTitle: "당시 제목",
      rating: 5,
    });
    await db
      .update(base.posts)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(base.posts.id, post!.id));
  }
  if (options.status && options.status !== "confirmed")
    await db
      .update(base.eventApplications)
      .set({ status: options.status })
      .where(eq(base.eventApplications.id, application!.id));
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, postId));
  return application!.id;
}
async function credit(
  postId: string,
  user: string,
  options: {
    role?: "기획자" | "MC" | "디자인";
    status?: "pending" | "accepted" | "rejected" | "withdrawn" | "correction_requested";
  } = {},
) {
  return db.insert(eventCredits).values({
    postId,
    userId: user,
    role: options.role ?? "MC",
    confirmedBy: host,
    status: options.status ?? "pending",
    acceptedAt: options.status === "accepted" ? ended : null,
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
  await pg.exec("truncate auth.users cascade");
  host = await member("주최자");
  manager = await member("지정 담당자");
  viewer = await member("참가 회원");
});
after(() => pg.close());

test("strict filters bound pages and keep a fixed page size", () => {
  assert.deepEqual(aftercareQuerySchema.parse({}), { scope: "all", view: "pending", page: 1 });
  for (const input of [
    { page: "0" },
    { page: "1001" },
    { page: "1.5" },
    { page: "NaN" },
    { scope: "everyone" },
    { view: "draft" },
    { pageSize: "200" },
  ])
    assert.equal(aftercareQuerySchema.safeParse(input).success, false);
  assert.equal(
    aftercareQuerySchema.parse({ scope: "hosting", view: "all", page: "1000" }).page,
    1000,
  );
});
test("only existing active authenticated members may list their tasks", async () => {
  await assert.rejects(service.list(null), code("UNAUTHENTICATED"));
  await assert.rejects(service.list(randomUUID()), code("FORBIDDEN"));
  await db.insert(memberSafety).values({ userId: viewer, status: "closed" });
  await assert.rejects(service.list(viewer), code("FORBIDDEN"));
  await db
    .update(memberSafety)
    .set({ status: "suspended", suspendedUntil: new Date("2100-01-01") })
    .where(eq(memberSafety.userId, viewer));
  await assert.rejects(service.list(viewer), code("FORBIDDEN"));
});
test("closing recruitment is not completion; owner and manager get only their actions", async () => {
  const id = await event();
  await event({ endsAt: null });
  await event({ endsAt: new Date("2100-01-01T03:00:00Z") });
  await db.insert(base.roomManagers).values({ postId: id, userId: manager });
  const own = await service.list(host, { scope: "hosting" });
  assert.equal(own.total, 1);
  assert.equal(own.items[0]?.stage, "completion");
  assert.equal(own.items[0]?.role, "host");
  assert.equal(own.items[0]?.actions[0]?.href, `/management/events/${id}#event-completion`);
  const appointed = await service.list(manager, { scope: "hosting" });
  assert.equal(appointed.items[0]?.role, "manager");
  assert.equal(
    appointed.items[0]?.actions.some((a) => a.href.endsWith("/edit")),
    false,
  );
  assert.equal((await service.list(viewer, { view: "all" })).total, 0);
  await db.insert(base.roomManagers).values({ postId: id, userId: host });
  assert.equal((await service.list(host, { scope: "hosting" })).total, 1);
});
test("completed hosting uses immutable snapshot and only host edits draft or withdrawn reflection", async () => {
  const id = await event({ completed: true });
  await db.insert(base.roomManagers).values({ postId: id, userId: manager });
  await db
    .update(base.posts)
    .set({ title: "모집글 새 제목", categorySlug: "travel" })
    .where(eq(base.posts.id, id));
  let result = await service.list(host, { scope: "hosting" });
  assert.equal(result.items[0]?.stage, "reflection");
  assert.equal(result.items[0]?.title, "행사 당시 제목");
  assert.equal(result.items[0]?.category, "mind-games");
  assert.equal(result.items[0]?.actions[0]?.href, `/records/${id}/edit`);
  assert.equal((await service.list(manager, { scope: "hosting" })).total, 0);
  const managerAll = await service.list(manager, { scope: "hosting", view: "all" });
  assert.equal(managerAll.items[0]?.stage, "ready");
  assert.equal(
    managerAll.items[0]?.actions.some((a) => a.href.endsWith("/edit")),
    false,
  );
  await db
    .update(base.eventRecords)
    .set({ status: "withdrawn" })
    .where(eq(base.eventRecords.postId, id));
  result = await service.list(host, { scope: "hosting" });
  assert.equal(result.items[0]?.stage, "reflection");
  await db
    .update(base.eventRecords)
    .set({ status: "published", publishedAt: ended })
    .where(eq(base.eventRecords.postId, id));
  assert.equal((await service.list(host, { scope: "hosting" })).total, 0);
  result = await service.list(host, { scope: "hosting", view: "all" });
  assert.equal(result.items[0]?.stage, "ready");
  assert.equal(result.pendingTotal, 0);
  assert.ok(result.items[0]?.actions.some((a) => a.href === `/records/${id}`));
});
test("manager gets pending credit count without names; blocked/inactive recipients do not count", async () => {
  const id = await event({ completed: true, status: "published" });
  await db.insert(base.roomManagers).values({ postId: id, userId: manager });
  const blocked = await member("非表示本人"),
    closed = await member("退会本人");
  await credit(id, viewer);
  await credit(id, viewer, { role: "디자인" });
  await credit(id, blocked);
  await credit(id, closed);
  await db
    .insert(memberBlocks)
    .values({ blockerId: blocked, blockedId: manager, displayLabel: "테스트 차단" });
  await db.insert(memberSafety).values({ userId: closed, status: "closed" });
  const result = await service.list(manager, { scope: "hosting" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.stage, "credits");
  assert.ok(result.items[0]?.description.includes("2건"));
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    host,
    viewer,
    blocked,
    closed,
    "非表示本人",
    "退会本人",
    "nickname",
    "contact",
    "userId",
  ])
    assert.equal(serialized.includes(forbidden), false);
});
test("own multiple credit requests group by event and accept only after formal completion", async () => {
  const beforeCompletion = await event();
  await credit(beforeCompletion, viewer);
  const id = await event({ completed: true });
  await credit(id, viewer);
  await credit(id, viewer, { role: "디자인" });
  const result = await service.list(viewer, { scope: "credits" });
  assert.equal(result.total, 1);
  assert.equal(result.pendingTotal, 1);
  assert.equal(result.items[0]?.id, "credits:" + id);
  assert.equal(result.items[0]?.stage, "credits");
  assert.ok(result.items[0]?.description.includes("2건"));
  assert.equal(result.items[0]?.actions[0]?.href, "/players/me/credits");
  assert.equal(
    result.items[0]?.actions.some((a) => a.href === `/records/${id}`),
    false,
  );
});
test("rejected and withdrawn contributions disappear; accepted and correction remain private nonpending history", async () => {
  const accepted = await event({ completed: true, status: "published" });
  await credit(accepted, viewer, { status: "accepted" });
  const correction = await event({ completed: true });
  await credit(correction, viewer, { status: "correction_requested" });
  await credit(await event({ completed: true }), viewer, { status: "rejected" });
  await credit(await event({ completed: true }), viewer, { status: "withdrawn" });
  assert.equal((await service.list(viewer, { scope: "credits" })).total, 0);
  const result = await service.list(viewer, { scope: "credits", view: "all" });
  assert.equal(result.total, 2);
  assert.equal(result.pendingTotal, 0);
  assert.equal(result.items.find((r) => r.postId === accepted)?.stage, "ready");
  assert.equal(result.items.find((r) => r.postId === correction)?.stage, "credits");
  assert.equal(result.items.find((r) => r.postId === correction)?.pending, false);
});
test("review eligibility follows QR confirmed ended nonhost nonduplicate policy, refunds preserve actual attendance", async () => {
  const qr = await event({ completed: true, status: "published" });
  await attend(qr, viewer, { qr: true, result: "attended" });
  const manual = await event({ completed: true });
  await attend(manual, viewer, { result: "attended" });
  const refunded = await event({ completed: true });
  await attend(refunded, viewer, { qr: true, result: "attended", status: "refunded" });
  const noShow = await event({ completed: true });
  await attend(noShow, viewer, { result: "no_show" });
  const priorReview = await event({ completed: true });
  await attend(priorReview, viewer, { qr: true, result: "attended", review: true });
  const refundNoAttendance = await event({ completed: true });
  await attend(refundNoAttendance, viewer, { status: "refunded" });
  const pending = await service.list(viewer, { scope: "participation" });
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0]?.postId, qr);
  assert.equal(pending.items[0]?.stage, "review");
  assert.equal(pending.items[0]?.actions[0]?.href, `/events/${qr}#event-reviews`);
  const all = await service.list(viewer, { scope: "participation", view: "all" });
  assert.equal(all.total, 4);
  assert.equal(all.pendingTotal, 1);
  assert.equal(all.items.find((r) => r.postId === manual)?.stage, "ready");
  assert.equal(all.items.find((r) => r.postId === refunded)?.stage, "ready");
  assert.ok(all.items.find((r) => r.postId === refunded)?.description.includes("환불"));
  assert.equal(all.items.find((r) => r.postId === priorReview)?.stage, "ready");
  for (const forbidden of [
    host,
    viewer,
    "비공개 신청자",
    "비공개 응답",
    "비공개 참가 요청사항",
    "bodyMarkdown",
    "bodyDocument",
    "answers",
    "contact",
  ])
    assert.equal(JSON.stringify(all).includes(forbidden), false);
});
test("QR reviews may precede official completion but hosts and contradictory no_show records are excluded", async () => {
  const qr = await event();
  await attend(qr, viewer, { qr: true });
  assert.equal((await service.list(viewer, { scope: "participation" })).total, 1);
  const hostEvent = await event({ owner: viewer, completed: true });
  await attend(hostEvent, viewer, { qr: true, result: "attended" });
  const missed = await event({ completed: true });
  await attend(missed, viewer, { qr: true, result: "no_show" });
  const all = await service.list(viewer, { scope: "participation", view: "all" });
  assert.deepEqual(
    all.items.map((r) => r.postId),
    [qr],
  );
});
test("hide cancel sample deletion and bidirectional host blocks apply before every scope and count", async () => {
  const keep = await event({ completed: true, status: "published" });
  await attend(keep, viewer, { qr: true, result: "attended" });
  await credit(keep, viewer);
  for (const mode of [
    "post-hidden",
    "record-hidden",
    "cancelled",
    "sample",
    "deleted",
    "closed-host",
    "host-blocks",
    "viewer-blocks",
  ]) {
    const owner = await member("숨겨진 주최자 " + mode);
    const id = await event({
      owner,
      completed: true,
      status: "published",
      sample: mode === "sample",
    });
    if (mode !== "cancelled")
      await attend(id, viewer, {
        qr: true,
        result: "attended",
        status: mode === "deleted" ? "cancelled" : "confirmed",
      });
    await credit(id, viewer);
    await db.insert(base.roomManagers).values({ postId: id, userId: viewer });
    if (mode.endsWith("hidden"))
      await db.insert(contentRestrictions).values({
        targetType: mode === "post-hidden" ? "post" : "record",
        targetId: id,
        reason: "검토",
      });
    if (mode === "cancelled") {
      const startsAt = new Date("2100-01-01T01:00:00Z"),
        endsAt = new Date("2100-01-01T03:00:00Z");
      await db
        .update(base.eventSettings)
        .set({ startsAt, endsAt })
        .where(eq(base.eventSettings.postId, id));
      await db.insert(eventChanges).values({
        postId: id,
        kind: "cancel",
        revision: 1,
        reason: "행사 취소",
        beforeStartsAt: startsAt,
        beforeEndsAt: endsAt,
        createdBy: owner,
      });
      await db
        .insert(eventLifecycle)
        .values({ postId: id, revision: 1, cancelledAt: ended, cancellationReason: "행사 취소" });
      await db
        .update(base.eventSettings)
        .set({ startsAt: new Date("2020-01-01T01:00:00Z"), endsAt: ended })
        .where(eq(base.eventSettings.postId, id));
    }
    if (mode === "deleted")
      await db
        .update(base.posts)
        .set({ status: "deleted", deletedAt: ended })
        .where(eq(base.posts.id, id));
    if (mode === "closed-host")
      await db.insert(memberSafety).values({ userId: owner, status: "closed" });
    if (mode === "host-blocks")
      await db
        .insert(memberBlocks)
        .values({ blockerId: owner, blockedId: viewer, displayLabel: "테스트 차단" });
    if (mode === "viewer-blocks")
      await db
        .insert(memberBlocks)
        .values({ blockerId: viewer, blockedId: owner, displayLabel: "테스트 차단" });
  }
  const result = await service.list(viewer, { view: "all" });
  assert.equal(result.total, 2);
  assert.equal(result.pendingTotal, 2);
  assert.deepEqual(new Set(result.items.map((r) => r.postId)), new Set([keep]));
  assert.equal((await service.list(viewer, { scope: "hosting", view: "all" })).total, 0);
});
test("pagination stays bounded, deterministic and ACL-filtered with counts outside selected view", async () => {
  for (let i = 0; i < 42; i++) await event({ title: "종료 확인 행사 " + i });
  const done = await event({ completed: true, status: "published" });
  const hidden = await event();
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: hidden, reason: "검토" });
  const first = await service.list(host, { scope: "hosting" });
  const second = await service.list(host, { scope: "hosting", page: 2 });
  const last = await service.list(host, { scope: "hosting", page: 1000 });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 20);
  assert.equal(last.items.length, 2);
  assert.equal(first.total, 42);
  assert.equal(first.pendingTotal, 42);
  assert.equal(last.page, 3);
  assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map((r) => r.id)).size, 42);
  assert.deepEqual((await service.list(host, { scope: "hosting" })).items, first.items);
  const all = await service.list(host, { scope: "hosting", view: "all", page: 3 });
  assert.equal(all.total, 43);
  assert.equal(all.pendingTotal, 42);
  assert.equal(all.items.length, 3);
  assert.equal(all.items.at(-1)?.postId, done);
});
test("reads create no records or credits, publish nothing and do not change completion", async () => {
  const pending = await event(),
    completed = await event({ completed: true });
  await credit(completed, viewer);
  const recordsBefore = await db.select().from(base.eventRecords),
    creditsBefore = await db.select().from(eventCredits),
    settingsBefore = await db.select().from(base.eventSettings);
  for (let i = 0; i < 3; i++) {
    await service.list(host, { view: "all" });
    await service.list(viewer);
  }
  assert.deepEqual(await db.select().from(base.eventRecords), recordsBefore);
  assert.deepEqual(await db.select().from(eventCredits), creditsBefore);
  assert.deepEqual(await db.select().from(base.eventSettings), settingsBefore);
  assert.equal(
    recordsBefore.some((r) => r.postId === pending),
    false,
  );
  assert.equal(recordsBefore[0]?.status, "draft");
});

test("legacy completion without a record asks managers to recheck completion rather than silently disappearing", async () => {
  const id = await event({ completed: true });
  await db.delete(base.eventRecords).where(eq(base.eventRecords.postId, id));
  await db.insert(base.roomManagers).values({ postId: id, userId: manager });
  for (const user of [host, manager]) {
    const result = await service.list(user, { scope: "hosting" });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.stage, "completion");
    assert.equal(result.items[0]?.pending, true);
    assert.equal(result.items[0]?.label, "기록 초안 확인 필요");
    assert.equal(result.items[0]?.title, "나의 행사 제목");
    assert.equal(result.items[0]?.actions[0]?.href, `/management/events/${id}#event-completion`);
  }
  assert.equal((await service.list(viewer, { view: "all" })).total, 0);
});

test("credit correction requests remain actionable for the host and assigned manager", async () => {
  const id = await event({ completed: true, status: "published" });
  await db.insert(base.roomManagers).values({ postId: id, userId: manager });
  await credit(id, viewer, { status: "correction_requested" });
  for (const user of [host, manager]) {
    const page = await service.list(user, { scope: "hosting" });
    assert.equal(page.pendingTotal, 1);
    assert.equal(page.items[0]?.stage, "credits");
    assert.equal(page.items[0]?.label, "제작 경력 정정 요청");
    assert.ok(page.items[0]?.description.includes("정정 요청 1건"));
    assert.ok(
      page.items[0]?.actions.some(
        (action) => action.href === "/management/events/" + id + "#event-credits",
      ),
    );
  }
  assert.equal((await service.list(viewer, { scope: "credits" })).pendingTotal, 0);
});
