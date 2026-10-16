import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { profiles, posts, comments, categories } from "../src/db/schema";
import {
  memberSafety,
  moderationAudit,
  safetyReports,
  staffRoles,
  supportReplies,
  supportTickets,
} from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  appealQuerySchema,
  appealSubmissionSchema,
  type AppealActionType,
} from "../src/domain/appeals";
import { appealService } from "../src/server/appeal-service";
import { safetyService } from "../src/server/safety-service";
import { operationsService } from "../src/server/operations-service";
import { crewService } from "../src/server/crew-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  appeals = appealService(connection),
  safety = safetyService(connection),
  operations = operationsService(connection);
let owner: string, reporter: string, originalStaff: string, reviewer: string;
const body = "본인에게 적용된 조치를 재검토해주시고 추가 설명을 부탁드립니다.";
const internal =
  "PRIVATE-STAFF-REASON 신고자 개인정보와 내부 증거는 회원 응답에 포함하지 않습니다.";
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const databaseCode = (expected: string) => (error: unknown) => {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
  return !!cause && typeof cause === "object" && "code" in cause && cause.code === expected;
};
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(profiles).values({ id, nickname });
  return id;
}
async function original(action: AppealActionType = "hide", authorId = owner) {
  const [post] = await db
    .insert(posts)
    .values({
      authorId,
      categorySlug: "party",
      title: "PRIVATE-TARGET-TITLE 익명 조치 대상",
      bodyMarkdown: "PRIVATE-TARGET-BODY 공개해서는 안 되는 원문입니다.",
      kind: "이야기",
      isAnonymous: true,
    })
    .returning();
  const [audit] = await db
    .insert(moderationAudit)
    .values({
      actorId: originalStaff,
      action,
      targetType: "post",
      targetId: post!.id,
      reason: internal,
    })
    .returning();
  return { post: post!, audit: audit! };
}
async function open(action: AppealActionType = "hide") {
  const fixture = await original(action);
  const result = await appeals.submit(owner, { mode: "open", actionId: fixture.audit.id, body });
  return { ...fixture, ticket: result.action.ticket! };
}

before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate sliper.moderation_audit cascade;truncate auth.users cascade;");
  owner = await member("조치 대상 회원");
  reporter = await member("다른 회원");
  originalStaff = await member("원조치 담당자");
  reviewer = await member("독립 검토자");
  await db.insert(staffRoles).values([
    { userId: originalStaff, role: "admin" },
    { userId: reviewer, role: "moderator" },
  ]);
});
after(() => pg.close());

test("strict appeal inputs reject foreign identity, target forgery and malformed revisions", () => {
  assert.equal(appealQuerySchema.safeParse({ actionId: randomUUID(), page: 1 }).success, true);
  assert.equal(appealQuerySchema.safeParse({ userId: randomUUID() }).success, false);
  assert.equal(
    appealSubmissionSchema.safeParse({
      mode: "open",
      actionId: randomUUID(),
      body,
      userId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    appealSubmissionSchema.safeParse({
      mode: "open",
      actionId: randomUUID(),
      body,
      targetId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    appealSubmissionSchema.safeParse({
      mode: "followup",
      ticketId: randomUUID(),
      body,
      expectedRevision: 0,
    }).success,
    false,
  );
  assert.equal(
    appealSubmissionSchema.safeParse({ mode: "followup", ticketId: randomUUID(), body }).success,
    false,
  );
});

test("member actions are ownership-scoped, paginated and project no reporter, actor, target or raw evidence", async () => {
  const own = await original("warn"),
    other = await original("suspend", reporter);
  await db.insert(moderationAudit).values({
    actorId: originalStaff,
    action: "restore",
    targetType: "post",
    targetId: own.post.id,
    reason: internal,
  });
  const page = await appeals.list(owner);
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.id, own.audit.id);
  assert.equal(page.items[0]?.type, "warn");
  assert.equal(page.items[0]?.scope, "게시글");
  assert.equal(page.items[0]?.ticket, null);
  const serialized = JSON.stringify(page);
  for (const excluded of [
    internal,
    own.post.id,
    other.audit.id,
    owner,
    reporter,
    originalStaff,
    "PRIVATE-TARGET-TITLE",
    "PRIVATE-TARGET-BODY",
  ])
    assert.equal(serialized.includes(excluded), false);
  await assert.rejects(appeals.list(reporter, { actionId: own.audit.id }), code("NOT_FOUND"));
  await assert.rejects(
    appeals.submit(reporter, { mode: "open", actionId: own.audit.id, body }),
    code("NOT_FOUND"),
  );
  await assert.rejects(appeals.list(null), code("UNAUTHENTICATED"));
  await assert.rejects(appeals.list(randomUUID()), code("FORBIDDEN"));
  for (let i = 0; i < 22; i++) await original();
  const first = await appeals.list(owner),
    last = await appeals.list(owner, { page: 999 });
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 23);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 3);
});

test("original moderation recipients retain appeal rights after deletion without exposing them to another member", async () => {
  const own = await original();
  await db.update(posts).set({ status: "deleted" }).where(eq(posts.id, own.post.id));
  assert.equal((await appeals.list(owner, { actionId: own.audit.id })).total, 1);
  const [comment] = await db
    .insert(comments)
    .values({
      postId: own.post.id,
      authorId: owner,
      bodyMarkdown: "PRIVATE-COMMENT-BODY",
      status: "deleted",
    })
    .returning();
  const [commentAudit] = await db
    .insert(moderationAudit)
    .values({
      actorId: originalStaff,
      action: "hide",
      targetType: "comment",
      targetId: comment!.id,
      reason: internal,
    })
    .returning();
  assert.equal((await appeals.list(owner, { actionId: commentAudit!.id })).items[0]?.scope, "댓글");
  await db.update(posts).set({ authorId: null }).where(eq(posts.id, own.post.id));
  assert.equal((await appeals.list(owner, { actionId: own.audit.id })).total, 1);
  await assert.rejects(appeals.list(reporter, { actionId: own.audit.id }), code("NOT_FOUND"));
});

test("suspended members can request review, closed members cannot read, open or follow up", async () => {
  await db.insert(memberSafety).values({
    userId: owner,
    status: "suspended",
    reason: internal,
    suspendedUntil: new Date(Date.now() + 86400000),
  });
  await assert.rejects(safety.activeMember(owner), code("FORBIDDEN"));
  const result = await open("suspend");
  assert.equal((await appeals.list(owner)).total, 1);
  await db.update(memberSafety).set({ status: "closed" }).where(eq(memberSafety.userId, owner));
  await assert.rejects(appeals.list(owner), code("FORBIDDEN"));
  await assert.rejects(
    appeals.submit(owner, { mode: "open", actionId: result.audit.id, body }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    appeals.submit(owner, {
      mode: "followup",
      ticketId: result.ticket.id,
      expectedRevision: result.ticket.revision,
      body,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(safety.tickets(owner), code("FORBIDDEN"));
});

test("repeated opening reuses one immutable action-linked ticket and does not replace the first explanation", async () => {
  const fixture = await original();
  const [first, second] = await Promise.all([
    appeals.submit(owner, { mode: "open", actionId: fixture.audit.id, body }),
    appeals.submit(owner, {
      mode: "open",
      actionId: fixture.audit.id,
      body: "반복 제출에서도 첫 신청 내용을 그대로 유지해주세요.",
    }),
  ]);
  assert.equal(first.action.ticket!.id, second.action.ticket!.id);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.action.ticket!.body, body);
  assert.equal(second.action.ticket!.revision, 1);
  assert.equal((await db.select().from(supportTickets)).length, 1);
  assert.equal(
    (await db.select().from(moderationAudit).where(eq(moderationAudit.action, "appeal_open")))
      .length,
    1,
  );
  const [stored] = await db.select().from(supportTickets);
  assert.equal(stored?.originalActionId, fixture.audit.id);
});

test("neutral review is required for replies and triage even when the appellant is staff", async () => {
  const fixture = await open();
  await db.insert(staffRoles).values({ userId: owner, role: "moderator" });
  for (const forbidden of [originalStaff, owner]) {
    const item = await operations.detail(forbidden, "support", fixture.ticket.id);
    assert.deepEqual(item.allowedActions, []);
    assert.equal(item.canTriage, false);
    assert.match(item.reviewRestriction!, /다른 운영자/);
    assert.equal((await safety.ticketDetail(forbidden, fixture.ticket.id)).canReply, false);
    await assert.rejects(
      operations.triage(forbidden, "support", fixture.ticket.id, {
        action: "claim",
        expectedRevision: 1,
      }),
      code("FORBIDDEN"),
    );
    await assert.rejects(
      safety.reply(forbidden, fixture.ticket.id, {
        body: "본인 검토는 다른 담당자가 처리해야 합니다.",
        expectedRevision: 1,
      }),
      code("FORBIDDEN"),
    );
  }
  assert.equal((await safety.ticketDetail(reviewer, fixture.ticket.id)).canReply, true);
  await operations.triage(reviewer, "support", fixture.ticket.id, {
    action: "claim",
    expectedRevision: 1,
  });
  const item = await operations.detail(reviewer, "support", fixture.ticket.id);
  assert.equal(item.revision, 2);
  assert.equal(item.assignee?.isMine, true);
  await assert.rejects(
    safety.reply(reviewer, fixture.ticket.id, {
      body: "조치 근거를 독립적으로 검토한 결과입니다.",
    }),
    code("VALIDATION"),
  );
  await safety.reply(reviewer, fixture.ticket.id, {
    body: "조치 근거를 독립적으로 검토한 결과입니다.",
    expectedRevision: 2,
  });
  const own = (await appeals.list(owner)).items[0]!.ticket!;
  assert.equal(own.status, "answered");
  assert.equal(own.revision, 3);
  assert.equal(own.replies[0]?.role, "staff");
  assert.equal(JSON.stringify(own).includes(reviewer), false);
});

test("follow-up reopens the same ticket, preserves reviewer metadata and keeps latest staff response", async () => {
  const fixture = await open();
  await operations.triage(reviewer, "support", fixture.ticket.id, {
    action: "claim",
    expectedRevision: 1,
  });
  await operations.triage(reviewer, "support", fixture.ticket.id, {
    action: "start_review",
    expectedRevision: 2,
  });
  const deadline = new Date(Date.now() + 86400000).toISOString();
  await operations.triage(reviewer, "support", fixture.ticket.id, {
    action: "set_due",
    expectedRevision: 3,
    dueAt: deadline,
  });
  await safety.reply(reviewer, fixture.ticket.id, {
    body: "기존 조치를 독립적으로 재검토한 결과입니다.",
    expectedRevision: 4,
    close: true,
  });
  const answered = (await appeals.list(owner)).items[0]!.ticket!;
  assert.equal(answered.status, "closed");
  const result = await appeals.submit(owner, {
    mode: "followup",
    ticketId: fixture.ticket.id,
    expectedRevision: answered.revision,
    body: "추가 증거와 설명이 있어 같은 이의신청에 이어서 전달합니다.",
  });
  assert.equal(result.action.ticket!.id, fixture.ticket.id);
  assert.equal(result.action.ticket!.status, "open");
  assert.equal(result.action.ticket!.revision, answered.revision + 1);
  assert.deepEqual(
    result.action.ticket!.replies.map((reply) => reply.role),
    ["staff", "member"],
  );
  const queue = await operations.detail(reviewer, "support", fixture.ticket.id);
  assert.equal(queue.stage, "reviewing");
  assert.equal(queue.assignee?.isMine, true);
  assert.ok(queue.reviewStartedAt);
  assert.equal(new Date(queue.dueAt!).toISOString(), deadline);
  assert.equal(queue.lastResponse?.body, "기존 조치를 독립적으로 재검토한 결과입니다.");
  await assert.rejects(
    appeals.submit(reporter, {
      mode: "followup",
      ticketId: fixture.ticket.id,
      expectedRevision: result.action.ticket!.revision,
      body,
    }),
    code("NOT_FOUND"),
  );
});

test("optimistic revisions allow one parallel follow-up and roll back every stale reply", async () => {
  const fixture = await open();
  const outcomes = await Promise.allSettled([
    appeals.submit(owner, {
      mode: "followup",
      ticketId: fixture.ticket.id,
      expectedRevision: 1,
      body,
    }),
    appeals.submit(owner, {
      mode: "followup",
      ticketId: fixture.ticket.id,
      expectedRevision: 1,
      body,
    }),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find((result) => result.status === "rejected")!;
  assert.equal(rejected.status, "rejected");
  assert.ok(code("CONFLICT")(rejected.reason));
  assert.equal((await db.select().from(supportReplies)).length, 1);
  assert.equal((await appeals.list(owner)).items[0]!.ticket!.revision, 2);
  await assert.rejects(
    safety.reply(reviewer, fixture.ticket.id, {
      body: "오래된 화면에서는 답변을 덮어쓸 수 없어요.",
      expectedRevision: 1,
    }),
    code("CONFLICT"),
  );
  assert.equal((await db.select().from(supportReplies)).length, 1);
});

test("database guards reject forged owner/action, mutable linkage and non-neutral assignment or reply", async () => {
  const fixture = await open(),
    second = await original("warn");
  await assert.rejects(
    db.insert(supportTickets).values({
      userId: reporter,
      originalActionId: fixture.audit.id,
      category: "account",
      subject: "소유권 위조",
      body,
    }),
    databaseCode("23514"),
  );
  await assert.rejects(
    db.insert(supportTickets).values({
      userId: owner,
      originalActionId: second.audit.id,
      category: "refund",
      subject: "문의 유형 위조",
      body,
    }),
    databaseCode("23514"),
  );
  await assert.rejects(
    db
      .update(supportTickets)
      .set({ originalActionId: second.audit.id })
      .where(eq(supportTickets.id, fixture.ticket.id)),
    databaseCode("23514"),
  );
  await assert.rejects(
    db
      .update(supportTickets)
      .set({ userId: reporter })
      .where(eq(supportTickets.id, fixture.ticket.id)),
    databaseCode("23514"),
  );
  for (const forbidden of [originalStaff, owner])
    await assert.rejects(
      db
        .update(supportTickets)
        .set({ assignedTo: forbidden })
        .where(eq(supportTickets.id, fixture.ticket.id)),
      databaseCode("23514"),
    );
  await assert.rejects(
    db
      .insert(supportReplies)
      .values({ ticketId: fixture.ticket.id, authorId: originalStaff, body }),
    databaseCode("23514"),
  );
  await assert.rejects(
    db.insert(supportReplies).values({ ticketId: fixture.ticket.id, authorId: reporter, body }),
    databaseCode("23514"),
  );
  await db.insert(memberSafety).values({
    userId: reviewer,
    status: "suspended",
    suspendedUntil: new Date(Date.now() + 86400000),
    reason: internal,
  });
  await assert.rejects(
    safety.reply(reviewer, fixture.ticket.id, { body, expectedRevision: 1 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    db.insert(supportReplies).values({ ticketId: fixture.ticket.id, authorId: reviewer, body }),
    databaseCode("23514"),
  );
  await db.insert(memberSafety).values({ userId: owner, status: "closed", reason: internal });
  await assert.rejects(
    db.insert(supportReplies).values({ ticketId: fixture.ticket.id, authorId: owner, body }),
    databaseCode("23514"),
  );
});

test("member account and report views mask internal free text while staff and audit retain evidence", async () => {
  const fixture = await original();
  const report = await safety.report(reporter, {
    targetType: "post",
    targetId: fixture.post.id,
    reason: "privacy",
    detail: "회원 본인이 작성한 신고 설명입니다.",
  });
  const resolved = await safety.resolve(originalStaff, report.id, {
    action: "suspend",
    reason: internal,
    days: 7,
  });
  assert.equal(resolved.resolution, internal);
  const own = await safety.account(owner);
  assert.equal(own.status, "suspended");
  assert.match(own.reason, /이의신청/);
  assert.equal(JSON.stringify(own).includes(internal), false);
  assert.equal(JSON.stringify((await safety.reports(reporter)).items).includes(internal), false);
  assert.equal((await safety.reports(originalStaff, true)).items[0]!.resolution, internal);
  const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, owner));
  assert.equal(state?.reason, internal);
  const [storedReport] = await db
    .select()
    .from(safetyReports)
    .where(eq(safetyReports.id, report.id));
  assert.equal(storedReport?.resolution, internal);
  assert.equal(JSON.stringify((await appeals.list(owner)).items).includes(internal), false);
  await safety.resolve(originalStaff, report.id, { action: "restore", reason: internal });
  assert.equal(JSON.stringify((await safety.reports(reporter)).items).includes(internal), false);
  const dismissedFixture = await original("warn"),
    dismissedReport = await safety.report(reporter, {
      targetType: "post",
      targetId: dismissedFixture.post.id,
      reason: "other",
    });
  await safety.resolve(originalStaff, dismissedReport.id, { action: "dismiss", reason: internal });
  assert.equal(
    (await safety.reports(reporter)).items.find((item) => item.id === dismissedReport.id)
      ?.resolution,
    "신고 내용의 검토가 완료되었어요.",
  );
});

test("appeal tables and ownership helper remain inaccessible to public database roles", async () => {
  const fixture = await open();
  for (const role of ["anon", "authenticated"]) {
    await pg.exec("set role " + role);
    try {
      await assert.rejects(pg.query("select * from sliper.support_tickets"));
      await assert.rejects(pg.query("select * from sliper.moderation_audit"));
      await assert.rejects(
        pg.query("select sliper.appeal_action_belongs_to($1,$2)", [fixture.audit.id, owner]),
      );
    } finally {
      await pg.exec("reset role");
    }
  }
});

test("crew ownership transfer keeps warnings, linked follow-up and DB appeal rights with the original recipient", async () => {
  const crews = crewService(connection);
  const crew = await crews.create(owner, {
    name: "귀속 검증 크루",
    description: "조치를 받은 원래 회원의 이의신청 권한을 유지하는 크루입니다.",
    category: "party",
  });
  await crews.join(reporter, crew.id, {
    message: "함께 크루에서 활동합니다",
    publicNameConsent: true,
  });
  const [nextOwner] = await db.select().from(profiles).where(eq(profiles.id, reporter));
  const detail = await crews.detail(owner, crew.id);
  const request = detail.requests!.items.find((item) => item.publicId === nextOwner!.publicId)!;
  await crews.decide(owner, crew.id, { requestId: request.id, approve: true });
  const report = await safety.report(reporter, {
    targetType: "crew",
    targetId: crew.id,
    reason: "other",
    detail: "원래 리더에게 적용되는 경고 조치 확인",
  });
  await safety.resolve(originalStaff, report.id, { action: "warn", reason: internal });
  const [audit] = await db
    .select()
    .from(moderationAudit)
    .where(eq(moderationAudit.targetId, crew.id));
  assert.equal(audit!.affectedUserId, owner);
  const opened = await appeals.submit(owner, { mode: "open", actionId: audit!.id, body });
  await crews.transfer(owner, crew.id, { memberPublicId: nextOwner!.publicId });
  assert.equal((await appeals.list(owner, { actionId: audit!.id })).total, 1);
  assert.equal((await appeals.list(reporter)).total, 0);
  await assert.rejects(
    appeals.submit(reporter, { mode: "open", actionId: audit!.id, body }),
    code("NOT_FOUND"),
  );
  const followed = await appeals.submit(owner, {
    mode: "followup",
    ticketId: opened.action.ticket!.id,
    expectedRevision: opened.action.ticket!.revision,
    body,
  });
  assert.equal(followed.action.ticket!.id, opened.action.ticket!.id);
  assert.equal(followed.action.ticket!.replies[0]!.role, "member");
  await assert.rejects(
    db.insert(supportTickets).values({
      userId: reporter,
      originalActionId: audit!.id,
      category: "account",
      subject: "새 리더의 잘못된 요청",
      body,
    }),
    databaseCode("23514"),
  );
  await assert.rejects(
    db
      .update(moderationAudit)
      .set({ affectedUserId: reporter })
      .where(eq(moderationAudit.id, audit!.id)),
    databaseCode("23514"),
  );
  await assert.rejects(
    db.insert(moderationAudit).values({
      actorId: originalStaff,
      affectedUserId: owner,
      action: "warn",
      targetType: "crew",
      targetId: crew.id,
      reason: internal,
    }),
    databaseCode("23514"),
  );
});
