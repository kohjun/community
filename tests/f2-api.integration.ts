import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { mediaAssets, posts, profiles } from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import { mediaRetentionJobs } from "../src/db/media-retention-schema";
import {
  contentRestrictions,
  memberSafety,
  moderationAudit,
  requestLimits,
  safetyReports,
  staffRoles,
  supportReplies,
  supportTickets,
} from "../src/db/safety-schema";
import type { ActionResult } from "../src/domain/contracts";
import {
  APPEAL_PUBLIC_REASONS,
  type AppealPage,
  type AppealSubmission,
} from "../src/domain/appeals";
import type { MediaRetentionSummary } from "../src/domain/media-retention";
import type { OperationsItem } from "../src/domain/operations";
import type { ReportView, SupportView } from "../src/domain/safety";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  loadLocalTestAccount,
} from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  address = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("F2 HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw new Error("The existing local test account is required for F2 HTTP checks.");
const actor = account.userId,
  loopbackActor = "00000000-0000-4000-8000-000000000001",
  cookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guest = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
if (actor === loopbackActor)
  throw new Error("F2 HTTP checks require distinct existing local development identities.");

type Reply<T> = { status: number; result: ActionResult<T> };
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
  from = origin,
): Promise<Reply<T>> {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      ...(session ? { Cookie: session } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store", path);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(reply: Reply<T>): T {
  assert.equal(reply.status, 200, "The F2 fixture request must succeed.");
  assert.ok(reply.result.ok, "The F2 handler must return a success response.");
  return reply.result.data;
}
function privateSafe(value: unknown) {
  assert.equal(
    JSON.stringify(value).includes("F2-PRIVATE-"),
    false,
    "Internal moderation text must remain private.",
  );
}
function error(reply: Reply<unknown>, status: number, code: string) {
  assert.equal(reply.status, status);
  assert.equal(reply.result.ok, false);
  if (!reply.result.ok) assert.equal(reply.result.error.code, code);
  privateSafe(reply.result);
}
async function page(path: string, session = cookie) {
  const response = await fetch(origin + path, {
    headers: session ? { Cookie: session } : {},
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, html: await response.text() };
}

test("HTTP F2: private owner appeals during suspension, idempotency and conflicts, neutral review, closed account denial and readonly admin media retention", async () => {
  const connection = createDatabase(address.href, 1),
    db = connection.db,
    peer = randomUUID(),
    ownPost = randomUUID(),
    peerPost = randomUUID(),
    ownAction = randomUUID(),
    peerAction = randomUUID(),
    peerTicket = randomUUID(),
    reportId = randomUUID(),
    actors = [actor, loopbackActor];
  let captured = false,
    seeded = false;
  let originalRoles: (typeof staffRoles.$inferSelect)[] = [],
    originalStates: (typeof memberSafety.$inferSelect)[] = [],
    originalLimits: (typeof requestLimits.$inferSelect)[] = [];
  const appealPath = "/api/safety/appeals",
    originalBody = "원조치에 대한 사실관계와 본인의 설명을 확인하고 재검토해주세요.",
    followupBody = "당시 상황을 더 자세히 설명합니다. 같은 요청에서 추가 의견을 검토해주세요.",
    staffBody = "첨부한 설명을 확인하고 독립적으로 재검토했습니다. 처리 결과를 안내합니다.";
  async function role(id: string, value: "admin" | "moderator" | null) {
    await db.transaction(async (tx) => {
      await tx.delete(staffRoles).where(eq(staffRoles.userId, id));
      if (value) await tx.insert(staffRoles).values({ userId: id, role: value });
    });
  }
  async function state(value: "active" | "suspended" | "closed") {
    await db
      .insert(memberSafety)
      .values({
        userId: actor,
        status: value,
        reason: "F2-PRIVATE-ACCOUNT-REASON internal source details",
        suspendedUntil: value === "suspended" ? new Date(Date.now() + 86400000) : null,
      })
      .onConflictDoUpdate({
        target: memberSafety.userId,
        set: {
          status: value,
          reason: "F2-PRIVATE-ACCOUNT-REASON internal source details",
          suspendedUntil: value === "suspended" ? new Date(Date.now() + 86400000) : null,
          updatedAt: new Date(),
        },
      });
  }
  async function mediaDigest() {
    const snapshot = await db.transaction(
      async (tx) => ({
        images: await tx.select().from(mediaAssets).orderBy(mediaAssets.id),
        videos: await tx.select().from(videoAssets).orderBy(videoAssets.id),
        jobs: await tx.select().from(mediaRetentionJobs).orderBy(mediaRetentionJobs.id),
      }),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }
  try {
    assert.equal(
      data(await api<{ authenticated: boolean }>("/api/auth/test/session")).authenticated,
      true,
    );
    const identities = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.id, actors));
    assert.equal(identities.length, 2, "Both existing development accounts must be present.");
    originalRoles = await db.select().from(staffRoles).where(inArray(staffRoles.userId, actors));
    originalStates = await db
      .select()
      .from(memberSafety)
      .where(inArray(memberSafety.userId, actors));
    originalLimits = await db
      .select()
      .from(requestLimits)
      .where(
        and(
          eq(requestLimits.userId, actor),
          inArray(requestLimits.action, ["appeal_open", "appeal_followup"]),
        ),
      );
    captured = true;
    await db.transaction(async (tx) => {
      await tx
        .delete(requestLimits)
        .where(
          and(
            eq(requestLimits.userId, actor),
            inArray(requestLimits.action, ["appeal_open", "appeal_followup"]),
          ),
        );
      await tx
        .insert(memberSafety)
        .values({ userId: loopbackActor, status: "active", reason: "" })
        .onConflictDoUpdate({
          target: memberSafety.userId,
          set: { status: "active", reason: "", suspendedUntil: null, updatedAt: new Date() },
        });
    });
    await role(actor, null);
    await role(loopbackActor, "admin");
    await state("active");
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into auth.users(id) values(${peer}::uuid)`);
      await tx.insert(profiles).values({ id: peer, nickname: "F2 HTTP 임시 회원" });
      await tx.insert(posts).values([
        {
          id: ownPost,
          authorId: actor,
          categorySlug: "party",
          kind: "이야기",
          isAnonymous: true,
          title: "f2-own-" + randomUUID(),
          bodyMarkdown: "F2-PRIVATE-OWN-POST moderation source body",
        },
        {
          id: peerPost,
          authorId: peer,
          categorySlug: "party",
          kind: "이야기",
          isAnonymous: true,
          title: "f2-peer-" + randomUUID(),
          bodyMarkdown: "F2-PRIVATE-PEER-POST unrelated member body",
        },
      ]);
      await tx.insert(moderationAudit).values([
        {
          id: ownAction,
          actorId: loopbackActor,
          action: "suspend",
          targetType: "post",
          targetId: ownPost,
          reason: "F2-PRIVATE-ORIGINAL-REASON reporter and staff context",
        },
        {
          id: peerAction,
          actorId: actor,
          action: "hide",
          targetType: "post",
          targetId: peerPost,
          reason: "F2-PRIVATE-PEER-ACTION other member context",
        },
      ]);
      await tx.insert(supportTickets).values({
        id: peerTicket,
        userId: peer,
        originalActionId: peerAction,
        category: "account",
        subject: "외부 회원의 재검토 요청",
        body: "원조치 담당자와 다른 운영자가 이 요청을 검토해야 합니다.",
      });
      await tx.insert(safetyReports).values({
        id: reportId,
        reporterId: actor,
        targetType: "post",
        targetId: peerPost,
        reason: "other",
        detail: "신고 처리 결과의 회원 공개 범위를 확인합니다.",
        snapshot: "F2-PRIVATE-REPORT-SNAPSHOT staff source",
        status: "actioned",
        resolution: "F2-PRIVATE-REPORT-RESOLUTION internal treatment details",
        resolvedBy: loopbackActor,
        resolvedAt: new Date(),
      });
    });
    seeded = true;
    error(await api(appealPath, "GET", undefined, guest), 401, "UNAUTHENTICATED");
    error(
      await api(
        appealPath,
        "POST",
        { mode: "open", actionId: ownAction, body: originalBody },
        guest,
      ),
      401,
      "UNAUTHENTICATED",
    );
    error(
      await api(
        appealPath,
        "POST",
        { mode: "open", actionId: ownAction, body: originalBody },
        cookie,
        "https://untrusted.example.invalid",
      ),
      403,
      "FORBIDDEN",
    );
    for (const query of [
      "page=0",
      "page=10001",
      "page=1&page=1",
      "unknown=true",
      "actionId=invalid",
    ])
      error(await api(appealPath + "?" + query), 400, "VALIDATION");
    error(await api(appealPath + "?actionId=" + peerAction), 404, "NOT_FOUND");
    error(
      await api(appealPath, "POST", { mode: "open", actionId: peerAction, body: originalBody }),
      404,
      "NOT_FOUND",
    );
    await state("suspended");
    const accountState = data(await api<{ status: string; reason: string }>("/api/safety/account"));
    assert.equal(accountState.status, "suspended");
    assert.ok(accountState.reason.length > 0);
    privateSafe(accountState);
    const original = data(await api<AppealPage>(appealPath + "?actionId=" + ownAction));
    assert.equal(original.items[0]?.id, ownAction);
    assert.equal(original.items[0]?.reason, APPEAL_PUBLIC_REASONS.suspend);
    assert.equal(original.items[0]?.ticket, null);
    privateSafe(original);
    for (const forbidden of [
      "actorId",
      "userId",
      "targetId",
      "targetType",
      "reporterId",
      "snapshot",
    ])
      assert.equal(Object.hasOwn(original.items[0]!, forbidden), false);
    const opening = await Promise.all([
      api<AppealSubmission>(appealPath, "POST", {
        mode: "open",
        actionId: ownAction,
        body: originalBody,
      }),
      api<AppealSubmission>(appealPath, "POST", {
        mode: "open",
        actionId: ownAction,
        body: originalBody,
      }),
    ]);
    const submissions = opening.map(data);
    assert.deepEqual(submissions.map((item) => item.reused).sort(), [false, true]);
    const ticket = submissions[0]!.action.ticket!;
    assert.ok(ticket.id);
    assert.equal(submissions[1]!.action.ticket?.id, ticket.id);
    assert.equal(ticket.body, originalBody);
    const reused = data(
      await api<AppealSubmission>(appealPath, "POST", {
        mode: "open",
        actionId: ownAction,
        body: "재전송한 신청이 기존 본문을 덮어쓰지 않는지 확인해주세요.",
      }),
    );
    assert.equal(reused.reused, true);
    assert.equal(reused.action.ticket?.id, ticket.id);
    assert.equal(reused.action.ticket?.body, originalBody);
    const ownTicketPath = "/api/safety/admin/support/" + ticket.id,
      ownOperationPath = "/api/safety/admin/operations/support/" + ticket.id;
    const originalReviewer = data(await api<SupportView>(ownTicketPath, "GET", undefined, ""));
    assert.equal(originalReviewer.canReply, false);
    assert.equal(originalReviewer.originalAction?.id, ownAction);
    privateSafe(originalReviewer);
    const blockedOperations = data(
      await api<OperationsItem>(ownOperationPath, "GET", undefined, ""),
    );
    assert.equal(blockedOperations.canTriage, false);
    assert.deepEqual(blockedOperations.allowedActions, []);
    error(
      await api(
        ownTicketPath,
        "POST",
        { body: staffBody, close: false, expectedRevision: ticket.revision },
        "",
      ),
      403,
      "FORBIDDEN",
    );
    error(
      await api(
        ownOperationPath,
        "PATCH",
        { action: "claim", expectedRevision: ticket.revision },
        "",
      ),
      403,
      "FORBIDDEN",
    );
    const appended = await Promise.all([
      api<AppealSubmission>(appealPath, "POST", {
        mode: "followup",
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        body: followupBody,
      }),
      api<AppealSubmission>(appealPath, "POST", {
        mode: "followup",
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        body: followupBody,
      }),
    ]);
    assert.deepEqual(appended.map((reply) => reply.status).sort(), [200, 409]);
    error(
      appended.find((reply) => reply.status === 409)!,
      409,
      "CONFLICT",
    );
    const updated = data(appended.find((reply) => reply.status === 200)!).action.ticket!;
    assert.equal(updated.id, ticket.id);
    assert.equal(updated.revision, ticket.revision + 1);
    assert.equal(updated.replies.length, 1);
    assert.equal(updated.replies[0]?.role, "member");
    assert.equal(updated.replies[0]?.body, followupBody);
    privateSafe(updated);
    error(
      await api(appealPath, "POST", {
        mode: "followup",
        ticketId: peerTicket,
        expectedRevision: 1,
        body: followupBody,
      }),
      404,
      "NOT_FOUND",
    );
    const ownTickets = data(await api<{ items: SupportView[] }>("/api/safety/support"));
    assert.equal(
      ownTickets.items.some((item) => item.id === ticket.id),
      true,
    );
    assert.equal(
      ownTickets.items.some((item) => item.id === peerTicket),
      false,
    );
    privateSafe(ownTickets);
    // Ownership remains after deletion; the member summary must never project the original content.
    await db
      .update(posts)
      .set({ status: "deleted" })
      .where(and(eq(posts.id, ownPost), eq(posts.authorId, actor)));
    const deletedSource = data(await api<AppealPage>(appealPath + "?actionId=" + ownAction));
    assert.equal(deletedSource.items[0]?.ticket?.id, ticket.id);
    privateSafe(deletedSource);
    const appealPage = await page("/settings/appeals?actionId=" + ownAction);
    assert.equal(appealPage.status, 200);
    assert.equal(appealPage.html.includes("F2-PRIVATE-"), false);
    const guestPage = await page("/settings/appeals?actionId=" + ownAction, guest);
    assert.equal(guestPage.html.includes(originalBody), false);
    assert.equal(guestPage.html.includes(followupBody), false);
    await state("closed");
    error(await api(appealPath), 403, "FORBIDDEN");
    error(
      await api(appealPath, "POST", { mode: "open", actionId: ownAction, body: originalBody }),
      403,
      "FORBIDDEN",
    );
    error(
      await api(appealPath, "POST", {
        mode: "followup",
        ticketId: ticket.id,
        expectedRevision: updated.revision,
        body: followupBody,
      }),
      403,
      "FORBIDDEN",
    );
    const closedPage = await page("/settings/appeals?actionId=" + ownAction);
    assert.equal(closedPage.html.includes(originalBody), false);
    assert.equal(closedPage.html.includes(followupBody), false);
    await state("active");
    await role(actor, "admin");
    const selfReviewer = data(await api<SupportView>(ownTicketPath));
    assert.equal(selfReviewer.canReply, false);
    error(
      await api(ownTicketPath, "POST", { body: staffBody, expectedRevision: updated.revision }),
      403,
      "FORBIDDEN",
    );
    const peerTicketPath = "/api/safety/admin/support/" + peerTicket,
      peerOperationPath = "/api/safety/admin/operations/support/" + peerTicket;
    const peerOriginalReviewer = data(await api<SupportView>(peerTicketPath));
    assert.equal(peerOriginalReviewer.canReply, false);
    error(
      await api(peerTicketPath, "POST", { body: staffBody, expectedRevision: 1 }),
      403,
      "FORBIDDEN",
    );
    error(
      await api(peerOperationPath, "PATCH", { action: "claim", expectedRevision: 1 }),
      403,
      "FORBIDDEN",
    );
    const neutralReviewer = data(await api<SupportView>(peerTicketPath, "GET", undefined, ""));
    assert.equal(neutralReviewer.canReply, true);
    assert.equal(neutralReviewer.originalAction?.id, peerAction);
    const claimed = data(
      await api<OperationsItem>(
        peerOperationPath,
        "PATCH",
        { action: "claim", expectedRevision: 1 },
        "",
      ),
    );
    assert.equal(claimed.assignee?.isMine, true);
    error(await api(peerTicketPath, "POST", { body: staffBody }, ""), 400, "VALIDATION");
    error(
      await api(peerTicketPath, "POST", { body: staffBody, expectedRevision: 1 }, ""),
      409,
      "CONFLICT",
    );
    data(
      await api(
        peerTicketPath,
        "POST",
        { body: staffBody, expectedRevision: claimed.revision, close: true },
        "",
      ),
    );
    const reviewed = data(await api<SupportView>(peerTicketPath, "GET", undefined, ""));
    assert.equal(reviewed.status, "closed");
    assert.equal(reviewed.revision, claimed.revision + 1);
    assert.equal(reviewed.originalAction?.id, peerAction);
    assert.equal(reviewed.replies[0]?.role, "staff");
    assert.equal(reviewed.replies[0]?.body, staffBody);
    const reported = data(await api<{ items: ReportView[] }>("/api/safety/reports"));
    assert.ok(reported.items.some((item) => item.id === reportId && item.status === "actioned"));
    privateSafe(reported);
    const staffReport = data(await api<ReportView>("/api/safety/admin/reports/" + reportId));
    assert.equal(staffReport.resolution.startsWith("F2-PRIVATE-REPORT-RESOLUTION"), true);
    const retentionPath = "/api/safety/admin/media-retention";
    error(await api(retentionPath, "GET", undefined, guest), 401, "UNAUTHENTICATED");
    await role(actor, null);
    error(await api(retentionPath), 403, "FORBIDDEN");
    await role(actor, "moderator");
    error(await api(retentionPath), 403, "FORBIDDEN");
    await role(actor, "admin");
    error(await api(retentionPath + "?unknown=true"), 400, "VALIDATION");
    const beforeReads = await mediaDigest(),
      summary = data(await api<MediaRetentionSummary>(retentionPath));
    assert.equal(summary.retentionDays, 30);
    assert.ok(Number.isFinite(Date.parse(summary.checkedAt)));
    assert.deepEqual(
      Object.keys(summary).sort(),
      [
        "checkedAt",
        "eligibleImages",
        "eligibleVideos",
        "failed",
        "processing",
        "queued",
        "removed",
        "retentionDays",
      ].sort(),
    );
    for (const field of [
      "eligibleImages",
      "eligibleVideos",
      "failed",
      "processing",
      "queued",
      "removed",
    ] as const)
      assert.ok(Number.isInteger(summary[field]) && summary[field] >= 0);
    privateSafe(summary);
    const adminRetentionPage = await page("/admin/media-retention");
    assert.equal(adminRetentionPage.status, 200);
    assert.equal(adminRetentionPage.html.includes("F2-PRIVATE-"), false);
    const guestRetentionPage = await page("/admin/media-retention", guest);
    assert.equal(guestRetentionPage.html.includes("정리 가능한 미첨부 사진"), false);
    assert.equal(
      await mediaDigest(),
      beforeReads,
      "Retention GET and SSR must not reserve, alter or delete any media.",
    );
    const unsupported = await fetch(origin + retentionPath, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(
      unsupported.status,
      405,
      "The retention preview has no deletion mutation endpoint.",
    );
  } finally {
    try {
      if (seeded)
        await db.transaction(async (tx) => {
          const fixtureTickets = await tx
            .select({ id: supportTickets.id })
            .from(supportTickets)
            .where(
              and(
                inArray(supportTickets.originalActionId, [ownAction, peerAction]),
                inArray(supportTickets.userId, [actor, peer]),
              ),
            );
          const ticketIds = fixtureTickets.map((item) => item.id);
          if (ticketIds.length) {
            await tx.delete(supportReplies).where(inArray(supportReplies.ticketId, ticketIds));
            await tx
              .delete(supportTickets)
              .where(
                and(
                  inArray(supportTickets.id, ticketIds),
                  inArray(supportTickets.userId, [actor, peer]),
                ),
              );
            await tx
              .delete(moderationAudit)
              .where(
                and(
                  eq(moderationAudit.targetType, "ticket"),
                  inArray(moderationAudit.targetId, ticketIds),
                  inArray(moderationAudit.actorId, actors),
                ),
              );
          }
          await tx
            .delete(moderationAudit)
            .where(
              and(
                inArray(moderationAudit.id, [ownAction, peerAction]),
                inArray(moderationAudit.targetId, [ownPost, peerPost]),
              ),
            );
          await tx
            .delete(safetyReports)
            .where(
              and(
                eq(safetyReports.id, reportId),
                eq(safetyReports.reporterId, actor),
                eq(safetyReports.targetId, peerPost),
              ),
            );
          await tx
            .delete(contentRestrictions)
            .where(
              and(
                eq(contentRestrictions.targetType, "post"),
                inArray(contentRestrictions.targetId, [ownPost, peerPost]),
              ),
            );
          await tx
            .delete(posts)
            .where(
              and(inArray(posts.id, [ownPost, peerPost]), inArray(posts.authorId, [actor, peer])),
            );
          await tx.execute(sql`delete from auth.users where id=${peer}::uuid`);
        });
    } finally {
      try {
        if (captured)
          await db.transaction(async (tx) => {
            await tx.delete(staffRoles).where(inArray(staffRoles.userId, actors));
            if (originalRoles.length) await tx.insert(staffRoles).values(originalRoles);
            await tx.delete(memberSafety).where(inArray(memberSafety.userId, actors));
            if (originalStates.length) await tx.insert(memberSafety).values(originalStates);
            await tx
              .delete(requestLimits)
              .where(
                and(
                  eq(requestLimits.userId, actor),
                  inArray(requestLimits.action, ["appeal_open", "appeal_followup"]),
                ),
              );
            if (originalLimits.length) await tx.insert(requestLimits).values(originalLimits);
          });
      } finally {
        await connection.close();
      }
    }
  }
});
