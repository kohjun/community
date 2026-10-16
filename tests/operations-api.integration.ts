import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profiles } from "../src/db/schema";
import {
  moderationAudit,
  safetyReports,
  staffRoles,
  supportReplies,
  supportTickets,
} from "../src/db/safety-schema";
import {
  libraryEntries,
  libraryVersions,
  libraryPurchases,
  libraryPurchaseDisputes,
  libraryPurchaseAudit,
  libraryWebhookReceipts,
} from "../src/db/library-schema";
import { libraryInputSchema } from "../src/domain/library";
import type { ActionResult } from "../src/domain/contracts";
import type { OperationsItem, OperationsPage } from "../src/domain/operations";
import type { PurchaseDetail } from "../src/domain/library-market";
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
  throw new Error("Operations HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error(
    "The existing local test account must be prepared before operations HTTP checks.",
  );
const actor = account.userId,
  cookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guest = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
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
      Cookie: session,
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
  assert.equal(reply.status, 200, "The operations fixture request must succeed.");
  assert.ok(reply.result.ok, "The operations handler must return a success response.");
  return reply.result.data;
}
function error(reply: Reply<unknown>, status: number, code: string) {
  assert.equal(reply.status, status);
  assert.equal(reply.result.ok, false);
  if (!reply.result.ok) assert.equal(reply.result.error.code, code);
  assert.equal(JSON.stringify(reply.result).includes("OPS-PRIVATE-"), false);
}
async function page(path: string, session = cookie) {
  const response = await fetch(origin + path, {
    headers: { Cookie: session },
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, html: await response.text() };
}
interface Health {
  checkedAt: string;
  queues: Array<{
    key: string;
    label: string;
    waiting: number;
    processing: number;
    retrying: number;
    failed: number;
    staleLeases: number;
    oldestWaitingAt: string | null;
    latestCompletedAt: string | null;
  }>;
  media: {
    abandonedImages: number;
    abandonedVideos: number;
    videoSourcesToClean: number;
    videoOutputsToClean: number;
  };
  configuration: { mediaStorage: string; roomUpdates: string; push: string; pushWorker: string };
}
const libraryContent = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "operations-paid-" + randomUUID(),
  summary: "운영 중재 권한과 개별 거래 처리 경계를 확인하는 자료입니다.",
  scenario: "OPS-PRIVATE-PAID-GUIDE 역할 카드와 제한 시간을 활용해 각 라운드를 진행합니다.",
  rules: "다른 참가자의 역할 카드를 공개하지 않고 정해진 순서와 시간을 지켜주세요.",
  hostGuide: "진행자는 준비물과 안전 수칙을 설명하고 참가자의 의견을 확인해주세요.",
  materials: [],
  minPlayers: 1,
  maxPlayers: 8,
  durationMinutes: 60,
  rounds: [{ name: "운영 라운드", seconds: 300 }],
  tags: [],
  priceKRW: 1000,
  purchaseUrl: "https://example.invalid/operations-purchase",
});

test("HTTP operations: staff-only queues, assignments, revision conflicts, current closures, neutral mediation and private health metadata", async () => {
  const connection = createDatabase(address.href, 1),
    db = connection.db;
  const peers = [randomUUID(), randomUUID()] as const,
    postIds = Array.from({ length: 21 }, () => randomUUID()),
    reportIds = Array.from({ length: 21 }, () => randomUUID()),
    supportId = randomUUID(),
    entryId = randomUUID(),
    versionId = randomUUID(),
    purchaseIds = [randomUUID(), randomUUID()] as const,
    disputeIds = [randomUUID(), randomUUID()] as const;
  let originalRole: typeof staffRoles.$inferSelect | undefined,
    roleChanged = false,
    seeded = false;
  const rootPath = "/api/safety/admin/operations",
    reportPath = rootPath + "/report/" + reportIds[0],
    supportPath = rootPath + "/support/" + supportId,
    disputePath = rootPath + "/dispute/" + disputeIds[0],
    selfDisputePath = rootPath + "/dispute/" + disputeIds[1];
  async function setRole(role: "admin" | "moderator" | null) {
    await db.transaction(async (tx) => {
      await tx.delete(staffRoles).where(eq(staffRoles.userId, actor));
      if (role) await tx.insert(staffRoles).values({ userId: actor, role });
    });
    roleChanged = true;
  }
  async function triage(
    path: string,
    revision: number,
    action: "claim" | "start_review" | "release" | "set_due",
    dueAt?: string | null,
  ) {
    return api<OperationsItem>(path, "PATCH", {
      action,
      expectedRevision: revision,
      ...(dueAt === undefined ? {} : { dueAt }),
    });
  }
  async function digest() {
    const snapshot = await db.transaction(async (tx) => ({
      reports: await tx
        .select()
        .from(safetyReports)
        .where(inArray(safetyReports.id, reportIds))
        .orderBy(safetyReports.id),
      tickets: await tx.select().from(supportTickets).where(eq(supportTickets.id, supportId)),
      replies: await tx
        .select()
        .from(supportReplies)
        .where(eq(supportReplies.ticketId, supportId))
        .orderBy(supportReplies.id),
      disputes: await tx
        .select()
        .from(libraryPurchaseDisputes)
        .where(inArray(libraryPurchaseDisputes.id, disputeIds))
        .orderBy(libraryPurchaseDisputes.id),
      purchases: await tx
        .select()
        .from(libraryPurchases)
        .where(inArray(libraryPurchases.id, purchaseIds))
        .orderBy(libraryPurchases.id),
      audit: await tx
        .select()
        .from(moderationAudit)
        .where(
          inArray(moderationAudit.targetId, [...postIds, supportId, ...reportIds, ...disputeIds]),
        )
        .orderBy(moderationAudit.id),
    }));
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }
  try {
    assert.equal(
      data(await api<{ authenticated: boolean }>("/api/auth/test/session")).authenticated,
      true,
    );
    [originalRole] = await db.select().from(staffRoles).where(eq(staffRoles.userId, actor));
    error(await api(rootPath, "GET", undefined, guest), 401, "UNAUTHENTICATED");
    error(await api("/api/safety/admin/health", "GET", undefined, guest), 401, "UNAUTHENTICATED");
    await setRole(null);
    error(await api(rootPath), 403, "FORBIDDEN");
    error(await api("/api/safety/admin/health"), 403, "FORBIDDEN");
    error(await triage(reportPath, 1, "claim"), 403, "FORBIDDEN");
    const memberPage = await page("/admin");
    assert.equal(memberPage.status, 200);
    assert.equal(memberPage.html.includes("OPS-PRIVATE-"), false);
    await setRole("moderator");
    assert.equal(data(await api<OperationsPage>(rootPath)).role, "moderator");
    error(await api("/api/safety/admin/health"), 403, "FORBIDDEN");
    await setRole("admin");
    await db.transaction(async (tx) => {
      for (const [index, id] of peers.entries()) {
        await tx.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
        await tx.insert(profiles).values({ id, nickname: "운영 HTTP 임시 회원 " + (index + 1) });
      }
      await tx.insert(posts).values(
        postIds.map((id, index) => ({
          id,
          authorId: peers[0],
          categorySlug: "party" as const,
          kind: "이야기" as const,
          isAnonymous: true,
          title: "operations-report-" + index + "-" + randomUUID(),
          bodyMarkdown: "OPS-PRIVATE-REPORTED-BODY 신고 원본 내용입니다.",
        })),
      );
      await tx.insert(safetyReports).values(
        reportIds.map((id, index) => ({
          id,
          reporterId: peers[1],
          targetType: "post",
          targetId: postIds[index]!,
          reason: "other",
          detail: "OPS-PRIVATE-REPORT-DETAIL 운영 검증용 신고입니다.",
          snapshot: "OPS-PRIVATE-REPORTED-BODY 신고 원본 내용입니다.",
          assignedTo: index ? actor : null,
        })),
      );
      await tx.insert(supportTickets).values({
        id: supportId,
        userId: peers[1],
        category: "other",
        subject: "operations-support-" + randomUUID(),
        body: "OPS-PRIVATE-SUPPORT-BODY 운영 답변 및 종료를 확인할 문의입니다.",
        assignedTo: actor,
      });
      await tx.insert(libraryEntries).values({
        ...libraryContent,
        id: entryId,
        ownerId: peers[0],
        status: "published",
        publishedVersion: 1,
      });
      await tx.insert(libraryVersions).values({
        id: versionId,
        entryId,
        number: 1,
        content: libraryContent,
        changeSummary: "운영 HTTP 검증 자료",
        publisherId: peers[0],
      });
      for (const [index, id] of purchaseIds.entries()) {
        const buyerId = index ? actor : peers[1];
        await tx.insert(libraryPurchases).values({
          id,
          entryId,
          versionId,
          buyerId,
          sellerId: peers[0],
          amountKRW: 1000,
          status: "pending",
          externalReference: "OPS-ORDER-" + randomUUID(),
          snapshot: {
            title: libraryContent.title,
            versionNumber: 1,
            priceKRW: 1000,
            usageTerms: libraryContent.usageTerms,
            allowDerivatives: false,
            allowCommercialUse: false,
            purchaseUrl: libraryContent.purchaseUrl!,
          },
        });
        await tx
          .update(libraryPurchases)
          .set({ status: "paid" })
          .where(eq(libraryPurchases.id, id));
        await tx.insert(libraryPurchaseDisputes).values({
          id: disputeIds[index]!,
          purchaseId: id,
          requesterId: buyerId,
          kind: "delivery",
          body: index
            ? "OPS-PRIVATE-SELF-DISPUTE 본인 거래라 직접 중재하면 안 되는 문의입니다."
            : "OPS-PRIVATE-NEUTRAL-DISPUTE 다른 운영자가 처리할 수 있는 자료 문의입니다.",
          assignedTo: index ? null : actor,
        });
      }
    });
    seeded = true;
    // Repeat the non-staff SSR/API checks with the sensitive fixtures actually present.
    await setRole(null);
    for (const path of [rootPath, reportPath, supportPath, disputePath])
      error(await api(path), 403, "FORBIDDEN");
    const privateMemberPage = await page("/admin");
    assert.equal(privateMemberPage.status, 200);
    assert.equal(privateMemberPage.html.includes("OPS-PRIVATE-"), false);
    const guestAdminPage = await page("/admin", guest);
    assert.equal(guestAdminPage.html.includes("OPS-PRIVATE-"), false);
    await setRole("admin");
    for (const query of [
      "kind=unknown",
      "stage=open",
      "assignment=staff",
      "page=0",
      "page=10001",
      "kind=report&kind=support",
      "page=1&page=1",
      "unknown=true",
    ])
      error(await api(rootPath + "?" + query), 400, "VALIDATION");
    error(await api("/api/safety/admin/health?unknown=true"), 400, "VALIDATION");
    error(
      await api(
        reportPath,
        "PATCH",
        { action: "claim", expectedRevision: 1 },
        cookie,
        "https://untrusted.example.invalid",
      ),
      403,
      "FORBIDDEN",
    );
    error(
      await api(reportPath, "PATCH", { action: "claim", expectedRevision: 1 }, guest),
      401,
      "UNAUTHENTICATED",
    );
    for (const body of [
      { action: "claim", expectedRevision: 0 },
      { action: "claim", expectedRevision: 1, dueAt: null },
      { action: "set_due", expectedRevision: 1 },
      { action: "claim", expectedRevision: 1, assignedTo: actor },
    ])
      error(await api(reportPath, "PATCH", body), 400, "VALIDATION");
    let report = data(await api<OperationsItem>(reportPath));
    assert.equal(report.revision, 1);
    assert.equal(report.assignee, null);
    assert.equal(report.stage, "pending");
    report = data(await triage(reportPath, report.revision, "claim"));
    assert.equal(report.revision, 2);
    assert.equal(report.assignee?.isMine, true);
    error(await triage(reportPath, 1, "claim"), 409, "CONFLICT");
    const query = rootPath + "?kind=report&stage=pending&assignment=mine&page=";
    const first = data(await api<OperationsPage>(query + "1")),
      second = data(await api<OperationsPage>(query + "2"));
    assert.equal(first.items.length, 20);
    assert.ok(first.total >= 21);
    assert.ok(first.pageCount >= 2);
    assert.equal(first.page, 1);
    assert.equal(second.page, 2);
    assert.ok(second.items.length > 0);
    assert.ok(first.counts.pending >= 21);
    assert.equal(
      first.items.every((item) => item.kind === "report" && item.assignee?.isMine),
      true,
    );
    const seen = new Set<string>();
    for (let current = 1; current <= Math.min(first.pageCount, 25); current++) {
      const result =
        current === 1
          ? first
          : current === 2
            ? second
            : data(await api<OperationsPage>(query + current));
      for (const item of result.items) {
        assert.equal(seen.has(item.id), false);
        seen.add(item.id);
      }
    }
    assert.equal(
      reportIds.every((id) => seen.has(id)),
      true,
    );
    const beforeReads = await digest();
    const combined = data(
      await api<OperationsPage>(rootPath + "?kind=all&stage=all&assignment=mine"),
    );
    assert.equal(
      combined.items.some((item) => item.id === disputeIds[1]),
      false,
    );
    for (const [kind, id] of [
      ["report", reportIds[0]],
      ["support", supportId],
      ["dispute", disputeIds[0]],
    ] as const) {
      const result = data(
        await api<OperationsPage>(rootPath + "?kind=" + kind + "&stage=all&assignment=mine"),
      );
      assert.ok(result.items.every((item) => item.kind === kind));
      const detail = data(await api<OperationsItem>(rootPath + "/" + kind + "/" + id));
      assert.equal(detail.id, id);
      assert.equal(detail.kind, kind);
      assert.ok(detail.href.startsWith("/") && !detail.href.startsWith("//"));
      for (const forbidden of [
        "reporterId",
        "userId",
        "buyerId",
        "sellerId",
        "assignedTo",
        "email",
        "phoneNumber",
        "contact",
        "snapshot",
      ])
        assert.equal(Object.hasOwn(detail, forbidden), false);
      const rendered = await page(detail.href);
      assert.equal(rendered.status, 200);
      assert.equal(rendered.html.includes("OPS-PRIVATE-PAID-GUIDE"), false);
      const noLogin = await page(detail.href, guest);
      assert.equal(noLogin.html.includes("OPS-PRIVATE-"), false);
    }
    const health = data(await api<Health>("/api/safety/admin/health"));
    assert.ok(Number.isFinite(Date.parse(health.checkedAt)));
    assert.ok(health.queues.length > 0);
    for (const queue of health.queues) {
      assert.equal(typeof queue.key, "string");
      assert.equal(typeof queue.label, "string");
      for (const value of [
        queue.waiting,
        queue.processing,
        queue.retrying,
        queue.failed,
        queue.staleLeases,
      ])
        assert.ok(Number.isInteger(value) && value >= 0);
      for (const value of [queue.oldestWaitingAt, queue.latestCompletedAt])
        assert.ok(value === null || Number.isFinite(Date.parse(value)));
      for (const forbidden of ["id", "body", "endpoint", "contact", "lastError", "payload"])
        assert.equal(Object.hasOwn(queue, forbidden), false);
    }
    for (const value of Object.values(health.media))
      assert.ok(Number.isInteger(value) && value >= 0);
    assert.ok(["local", "supabase", "invalid"].includes(health.configuration.mediaStorage));
    for (const value of [health.configuration.roomUpdates, health.configuration.push])
      assert.ok(["configured", "disabled", "invalid"].includes(value));
    assert.ok(["embedded", "external", "invalid"].includes(health.configuration.pushWorker));
    assert.equal(JSON.stringify(health).includes("OPS-PRIVATE-"), false);
    assert.equal(
      await digest(),
      beforeReads,
      "GET operations and health must not assign, advance, resolve or reply to fixtures.",
    );
    const adminPage = await page("/admin");
    assert.equal(adminPage.status, 200);
    assert.ok(adminPage.html.includes("운영 점검"));
    error(await api(selfDisputePath), 403, "FORBIDDEN");
    error(await triage(selfDisputePath, 1, "claim"), 403, "FORBIDDEN");
    report = data(await triage(reportPath, report.revision, "start_review"));
    assert.equal(report.stage, "reviewing");
    assert.ok(report.reviewStartedAt);
    const staleReview = report.revision - 1;
    error(await triage(reportPath, staleReview, "start_review"), 409, "CONFLICT");
    const due = new Date(Date.now() + 86400000).toISOString();
    report = data(await triage(reportPath, report.revision, "set_due", due));
    assert.equal(Date.parse(report.dueAt!), Date.parse(due));
    const concurrentRevision = report.revision;
    const concurrent = await Promise.all([
      triage(
        reportPath,
        concurrentRevision,
        "set_due",
        new Date(Date.now() + 2 * 86400000).toISOString(),
      ),
      triage(
        reportPath,
        concurrentRevision,
        "set_due",
        new Date(Date.now() + 3 * 86400000).toISOString(),
      ),
    ]);
    assert.deepEqual(concurrent.map((reply) => reply.status).sort(), [200, 409]);
    report = data(await api<OperationsItem>(reportPath));
    assert.equal(report.revision, concurrentRevision + 1);
    report = data(await triage(reportPath, report.revision, "release"));
    assert.equal(report.assignee, null);
    const beforeResolve = report.revision;
    data(
      await api("/api/safety/admin/reports/" + report.id, "POST", {
        action: "dismiss",
        reason: "운영 HTTP 검증을 마쳐 신고를 종결합니다.",
      }),
    );
    const resolvedReport = data(await api<OperationsItem>(reportPath));
    assert.equal(resolvedReport.sourceStatus, "dismissed");
    assert.equal(resolvedReport.stage, "completed");
    assert.ok(resolvedReport.revision > beforeResolve);
    error(await triage(reportPath, beforeResolve, "claim"), 409, "CONFLICT");
    error(await triage(reportPath, resolvedReport.revision, "claim"), 409, "CONFLICT");
    let support = data(await api<OperationsItem>(supportPath));
    support = data(await triage(supportPath, support.revision, "start_review"));
    assert.equal(support.stage, "reviewing");
    const beforeReply = support.revision;
    data(
      await api("/api/safety/admin/support/" + support.id, "POST", {
        body: "운영 HTTP 문의의 처리를 확인하고 종결합니다.",
        close: true,
      }),
    );
    const closedSupport = data(await api<OperationsItem>(supportPath));
    assert.equal(closedSupport.sourceStatus, "closed");
    assert.equal(closedSupport.stage, "completed");
    assert.ok(closedSupport.revision > beforeReply);
    assert.ok(closedSupport.lastResponse?.body.includes("문의의 처리"));
    error(await triage(supportPath, beforeReply, "release"), 409, "CONFLICT");
    error(await triage(supportPath, closedSupport.revision, "start_review"), 409, "CONFLICT");
    let dispute = data(await api<OperationsItem>(disputePath));
    dispute = data(await triage(disputePath, dispute.revision, "start_review"));
    assert.equal(dispute.stage, "reviewing");
    const purchase = data(await api<PurchaseDetail>("/api/library-market/" + purchaseIds[0])),
      currentDispute = purchase.disputes.find((item) => item.id === dispute.id)!;
    data(
      await api(
        "/api/library-market/" + purchaseIds[0] + "/disputes/" + dispute.id + "/resolve",
        "POST",
        {
          expectedUpdatedAt: currentDispute.updatedAt,
          outcome: "no_action",
          note: "서로의 거래 내역을 확인하고 운영 중재를 마칩니다.",
          paymentChecked: false,
        },
      ),
    );
    const resolvedDispute = data(await api<OperationsItem>(disputePath));
    assert.equal(resolvedDispute.sourceStatus, "resolved");
    assert.equal(resolvedDispute.stage, "completed");
    assert.ok(resolvedDispute.revision > dispute.revision);
    error(await triage(disputePath, dispute.revision, "start_review"), 409, "CONFLICT");
    const completed = data(await api<OperationsPage>(rootPath + "?stage=completed&assignment=all"));
    assert.ok(completed.counts.completed >= 3);
    assert.ok(completed.items.every((item) => item.stage === "completed"));
    const pending = data(await api<OperationsPage>(rootPath + "?stage=pending&assignment=mine"));
    assert.equal(
      pending.items.some((item) => [report.id, support.id, dispute.id].includes(item.id)),
      false,
    );
  } finally {
    try {
      if (seeded)
        await db.transaction(async (tx) => {
          await tx
            .delete(moderationAudit)
            .where(
              and(
                eq(moderationAudit.actorId, actor),
                inArray(moderationAudit.targetId, [
                  ...postIds,
                  supportId,
                  ...reportIds,
                  ...disputeIds,
                ]),
              ),
            );
          await tx
            .delete(supportTickets)
            .where(and(eq(supportTickets.id, supportId), eq(supportTickets.userId, peers[1]!)));
          await tx
            .delete(safetyReports)
            .where(
              and(inArray(safetyReports.id, reportIds), eq(safetyReports.reporterId, peers[1]!)),
            );
          await tx
            .delete(libraryPurchaseDisputes)
            .where(
              and(
                inArray(libraryPurchaseDisputes.id, disputeIds),
                inArray(libraryPurchaseDisputes.purchaseId, purchaseIds),
              ),
            );
          await tx
            .delete(libraryPurchaseAudit)
            .where(inArray(libraryPurchaseAudit.purchaseId, purchaseIds));
          await tx
            .delete(libraryWebhookReceipts)
            .where(inArray(libraryWebhookReceipts.purchaseId, purchaseIds));
          await tx
            .delete(libraryPurchases)
            .where(
              and(
                inArray(libraryPurchases.id, purchaseIds),
                eq(libraryPurchases.entryId, entryId),
                eq(libraryPurchases.sellerId, peers[0]!),
              ),
            );
          await tx
            .delete(libraryEntries)
            .where(and(eq(libraryEntries.id, entryId), eq(libraryEntries.ownerId, peers[0]!)));
          await tx
            .delete(posts)
            .where(and(inArray(posts.id, postIds), eq(posts.authorId, peers[0]!)));
          for (const id of peers)
            await tx.execute(sql`delete from auth.users where id=${id}::uuid`);
        });
    } finally {
      try {
        if (roleChanged)
          await db.transaction(async (tx) => {
            await tx.delete(staffRoles).where(eq(staffRoles.userId, actor));
            if (originalRole) await tx.insert(staffRoles).values(originalRole);
          });
      } finally {
        await connection.close();
      }
    }
  }
});
