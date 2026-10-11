import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as lifecycleSchema from "../src/db/event-lifecycle-schema";
import { admissionTickets, eventAdmissions } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { memberSafety, staffRoles } from "../src/db/safety-schema";
import { pushDeliveries, pushPreferences, pushSubscriptions } from "../src/db/push-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { participationService } from "../src/server/participation-service";
import { refundService } from "../src/server/refund-service";
import { AppError } from "../src/server/errors";
import { pushDispatcher } from "../src/server/push-dispatcher";

const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...lifecycleSchema } }),
  connection = db as unknown as Database;
let now: Date,
  owner: string,
  alice: string,
  bob: string,
  staff: string,
  outsider: string,
  postId: string,
  applicationId: string,
  originalStart: Date,
  originalEnd: Date;
const service = eventLifecycleService(connection, () => now),
  operations = eventOperationsService(connection, () => now),
  participation = participationService(connection),
  refunds = refundService(connection);
const code = (value: string) => (error: unknown) =>
  error instanceof AppError && error.code === value;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({
    id,
    nickname,
    phoneNumber: "01012345678",
    profileCompletedAt: now,
    onboardingConsentAt: now,
  });
  return id;
}
async function event(amount = 0) {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: "일정 변경 검증 행사",
      bodyMarkdown: "주최자 사정으로 일정이 바뀌는 경우를 검증합니다.",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: post!.id,
    amountKRW: amount,
    capacity: 20,
    startsAt: originalStart,
    endsAt: originalEnd,
  });
  return post!.id;
}
async function app(user = alice, id = postId, amount = 0, status = "confirmed") {
  const [row] = await db
    .insert(base.eventApplications)
    .values({
      postId: id,
      userId: user,
      attendeeName: "신청 참가자",
      contact: "test@example.invalid",
      amountKRW: amount,
      status: status === "confirmed" ? "confirmed" : "pending_payment",
      confirmedAt: status === "confirmed" ? now : null,
      expiresAt: new Date(now.getTime() + 30 * 60000),
      refundConsentAt: amount ? now : null,
    })
    .returning();
  if (status !== "confirmed" && status !== "pending_payment")
    await db
      .update(base.eventApplications)
      .set({ status })
      .where(eq(base.eventApplications.id, row!.id));
  return row!.id;
}
async function paid(status = "confirmed") {
  postId = await event(10001);
  applicationId = await app(alice, postId, 10001, "pending_payment");
  await db.insert(base.paymentOrders).values({
    applicationId,
    provider: "test-provider",
    amountKRW: 10001,
    state: "paid",
    paymentId: randomUUID(),
  });
  await db
    .update(base.eventApplications)
    .set({ status, confirmedAt: status === "confirmed" ? now : null })
    .where(eq(base.eventApplications.id, applicationId));
}
function change(kind: "cancel" | "reschedule" = "reschedule", expectedRevision = 0) {
  return {
    kind,
    expectedRevision,
    reason: "장소 운영 사정으로 변경합니다.",
    confirmed: true as const,
    ...(kind === "reschedule"
      ? {
          startsAt: new Date(originalStart.getTime() + 86400000).toISOString(),
          endsAt: new Date(originalEnd.getTime() + 86400000).toISOString(),
        }
      : {}),
  };
}
async function application() {
  return (
    await db
      .select()
      .from(base.eventApplications)
      .where(eq(base.eventApplications.id, applicationId))
  )[0]!;
}
async function pendingRefund() {
  return (
    await db
      .select()
      .from(base.refundRequests)
      .where(
        and(
          eq(base.refundRequests.applicationId, applicationId),
          eq(base.refundRequests.state, "pending"),
        ),
      )
  )[0];
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
  now = new Date();
  originalStart = new Date(now.getTime() + 12 * 3600000);
  originalEnd = new Date(originalStart.getTime() + 2 * 3600000);
  owner = await member("주최자");
  alice = await member("참가자");
  bob = await member("다른 참가자");
  staff = await member("현장 담당자");
  outsider = await member("다른 회원");
  postId = await event();
  applicationId = await app();
  await db.insert(base.roomManagers).values({ postId, userId: staff });
});
after(() => pg.close());

test("only the active host can change an event, including when a manager or platform admin requests it", async () => {
  await db.insert(staffRoles).values({ userId: outsider, role: "admin" });
  await assert.rejects(service.change(null, postId, change()), code("UNAUTHENTICATED"));
  await assert.rejects(service.change(staff, postId, change()), code("FORBIDDEN"));
  await assert.rejects(service.change(outsider, postId, change()), code("FORBIDDEN"));
  await db
    .insert(memberSafety)
    .values({ userId: owner, status: "suspended", reason: "운영 검토 중" });
  await assert.rejects(service.change(owner, postId, change()), code("FORBIDDEN"));
  assert.equal((await db.select().from(lifecycleSchema.eventChanges)).length, 0);
});

test("concurrent changes share the event lock and reject a stale revision without duplicate history", async () => {
  const outcomes = await Promise.allSettled([
    service.change(owner, postId, change()),
    service.change(owner, postId, change()),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = outcomes.find((item) => item.status === "rejected");
  assert.ok(rejected?.status === "rejected" && code("CONFLICT")(rejected.reason));
  const [state] = await db
    .select()
    .from(lifecycleSchema.eventLifecycle)
    .where(eq(lifecycleSchema.eventLifecycle.postId, postId));
  assert.equal(state?.revision, 1);
  assert.equal(
    (
      await db
        .select()
        .from(lifecycleSchema.eventChanges)
        .where(eq(lifecycleSchema.eventChanges.postId, postId))
    ).length,
    1,
  );
});

test("rescheduling retains participation, the original refund snapshot and consent, while invalidating every old QR", async () => {
  const before = await application(),
    ticket = await operations.issue(alice, postId, { applicationId });
  await service.change(owner, postId, change());
  const after = await application(),
    [settings] = await db
      .select()
      .from(base.eventSettings)
      .where(eq(base.eventSettings.postId, postId));
  assert.equal(after.status, "confirmed");
  assert.equal(after.eventStartsAt?.toISOString(), before.eventStartsAt?.toISOString());
  assert.equal(after.refundConsentAt?.toISOString(), before.refundConsentAt?.toISOString());
  assert.equal(after.refundPolicy, before.refundPolicy);
  assert.equal(settings?.startsAt?.toISOString(), change("reschedule").startsAt);
  assert.equal(
    (
      await db
        .select()
        .from(admissionTickets)
        .where(eq(admissionTickets.applicationId, applicationId))
    ).length,
    0,
  );
  await assert.rejects(operations.scan(owner, postId, { code: ticket.code }), code("NOT_FOUND"));
  assert.notEqual((await operations.issue(alice, postId, { applicationId })).code, ticket.code);
});

test("host cancellation is terminal, preserves confirmed participants and blocks QR, registration and checkout", async () => {
  const pendingId = await app(bob, postId, 0, "pending_payment");
  await service.change(owner, postId, change("cancel"));
  assert.equal((await application()).status, "confirmed");
  const [pending] = await db
    .select()
    .from(base.eventApplications)
    .where(eq(base.eventApplications.id, pendingId));
  assert.equal(pending?.status, "cancelled");
  await assert.rejects(service.change(owner, postId, change("reschedule", 1)), code("CONFLICT"));
  await assert.rejects(operations.issue(alice, postId, { applicationId }), code("CONFLICT"));
  await assert.rejects(
    participation.apply(outsider, postId, { consent: true }, null),
    code("CONFLICT"),
  );
  await assert.rejects(
    participation.configure(owner, postId, { amountKRW: 0, capacity: 20, open: true }),
    code("CONFLICT"),
  );
  const room = await participation.room(alice, postId);
  assert.ok(JSON.stringify(room).includes("행사 취소 안내"));
});

test("invalid schedules, missing confirmation and already started events leave no change history", async () => {
  await assert.rejects(service.change(owner, postId, { ...change(), confirmed: false }));
  await assert.rejects(service.change(owner, postId, { ...change(), startsAt: now.toISOString() }));
  await assert.rejects(service.change(owner, postId, { ...change(), endsAt: change().startsAt }));
  now = new Date(originalStart.getTime());
  await assert.rejects(service.change(owner, postId, change("cancel")), code("CONFLICT"));
  assert.equal((await db.select().from(lifecycleSchema.eventChanges)).length, 0);
});

test("a recorded QR admission or attendance prevents changing an event even before its clock start", async () => {
  await db
    .insert(eventAdmissions)
    .values({ applicationId, postId, userId: alice, checkedBy: staff, checkedAt: now });
  await assert.rejects(service.change(owner, postId, change()), code("CONFLICT"));
  await db.delete(eventAdmissions).where(eq(eventAdmissions.applicationId, applicationId));
  await db
    .insert(eventResults)
    .values({ applicationId, postId, userId: alice, recorderId: staff, presence: "attended" });
  await assert.rejects(service.change(owner, postId, change("cancel")), code("CONFLICT"));
});

test("change recipients retain only the applications affected when the host changed the schedule", async () => {
  const pendingId = await app(bob, postId, 0, "pending_payment"),
    cancelledId = await app(outsider, postId, 0, "cancelled");
  await service.change(owner, postId, change());
  const recipients = await db
    .select()
    .from(lifecycleSchema.eventChangeRecipients)
    .where(eq(lifecycleSchema.eventChangeRecipients.postId, postId));
  assert.deepEqual(
    recipients.map((row) => row.applicationId).sort(),
    [applicationId, pendingId].sort(),
  );
  assert.equal(
    recipients.some((row) => row.applicationId === cancelledId),
    false,
  );
  const newUser = await member("변경 후 참가자"),
    newApplication = await app(newUser);
  assert.equal(
    (
      await db
        .select()
        .from(lifecycleSchema.eventChangeRecipients)
        .where(eq(lifecycleSchema.eventChangeRecipients.applicationId, newApplication))
    ).length,
    0,
  );
});

test("participants can acknowledge their own notice only, and acknowledging it is idempotent", async () => {
  await service.change(owner, postId, change());
  const [record] = await db
    .select()
    .from(lifecycleSchema.eventChanges)
    .where(eq(lifecycleSchema.eventChanges.postId, postId));
  await assert.rejects(
    service.markRead(outsider, postId, { changeId: record!.id }),
    code("NOT_FOUND"),
  );
  await service.markRead(alice, postId, { changeId: record!.id });
  const [first] = await db
    .select()
    .from(lifecycleSchema.eventChangeRecipients)
    .where(eq(lifecycleSchema.eventChangeRecipients.applicationId, applicationId));
  assert.ok(first?.readAt);
  await service.markRead(alice, postId, { changeId: record!.id });
  const [second] = await db
    .select()
    .from(lifecycleSchema.eventChangeRecipients)
    .where(eq(lifecycleSchema.eventChangeRecipients.applicationId, applicationId));
  assert.equal(second?.readAt?.toISOString(), first?.readAt?.toISOString());
  const notices = await service.notices(outsider);
  assert.equal(JSON.stringify(notices).includes(record!.id), false);
  assert.equal(JSON.stringify(await service.notices(alice)).includes(alice), false);
});

test("cancellation queues full refunds but never marks the external money as returned", async () => {
  await paid();
  await service.change(owner, postId, change("cancel"));
  const request = await pendingRefund(),
    [order] = await db
      .select()
      .from(base.paymentOrders)
      .where(eq(base.paymentOrders.applicationId, applicationId));
  assert.equal(request?.rate, 100);
  assert.equal(request?.refundableKRW, 10001);
  assert.equal(request?.cause, "host_cancel");
  assert.equal(order?.state, "paid");
  assert.equal(order?.refundedAmountKRW, null);
  assert.equal((await application()).status, "confirmed");
});

test("host cancellation preserves an earlier reduced quote in rejected history and creates a full quote", async () => {
  await paid();
  await refunds.request(alice, postId, { applicationId, reason: "개인 사정으로 취소" });
  const earlier = await pendingRefund();
  assert.ok(earlier && earlier.rate < 100);
  await service.change(owner, postId, change("cancel"));
  const requests = await db
    .select()
    .from(base.refundRequests)
    .where(eq(base.refundRequests.applicationId, applicationId));
  const old = requests.find((row) => row.id === earlier.id),
    upgraded = requests.find((row) => row.state === "pending");
  assert.equal(old?.state, "rejected");
  assert.equal(old?.rate, earlier.rate);
  assert.equal(old?.refundableKRW, earlier.refundableKRW);
  assert.ok(old?.decisionNote);
  assert.equal(upgraded?.rate, 100);
  assert.equal(upgraded?.cause, "host_cancel");
});

test("an affected paid participant can request full refund after rescheduling while later joiners use the ordinary calendar rule", async () => {
  await paid();
  await service.change(owner, postId, change());
  const view = await refunds.overview(alice, postId);
  assert.equal(view.quote?.rate, 100);
  await refunds.request(alice, postId, { applicationId, reason: "변경된 일정에 참석할 수 없어요" });
  assert.equal((await pendingRefund())?.cause, "schedule_change");
  const newId = await app(bob, postId, 10001, "pending_payment");
  await db.insert(base.paymentOrders).values({
    applicationId: newId,
    provider: "test-provider",
    amountKRW: 10001,
    state: "paid",
    paymentId: randomUUID(),
  });
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: now })
    .where(eq(base.eventApplications.id, newId));
  const ordinary = await refunds.overview(bob, postId);
  assert.ok(ordinary.quote && ordinary.quote.rate < 100);
});

test("a paid callback after host cancellation enters review, cannot grant admission, and can request full refund", async () => {
  postId = await event(10001);
  applicationId = await app(alice, postId, 10001, "pending_payment");
  const [order] = await db
    .insert(base.paymentOrders)
    .values({ applicationId, provider: "test-provider", amountKRW: 10001 })
    .returning();
  await service.change(owner, postId, change("cancel"));
  await assert.rejects(participation.checkoutOrder(alice, order!.id), code("CONFLICT"));
  const callback = {
    eventId: randomUUID(),
    orderId: order!.id,
    paymentId: randomUUID(),
    amountKRW: 10001,
    currency: "KRW",
    status: "paid",
  };
  assert.equal((await participation.payment("test-provider", callback)).status, "review");
  assert.equal((await participation.payment("test-provider", callback)).duplicate, true);
  await assert.rejects(operations.issue(alice, postId, { applicationId }), code("CONFLICT"));
  await refunds.request(alice, postId, {
    applicationId,
    reason: "취소된 행사에 결제가 완료됐어요",
  });
  assert.equal((await pendingRefund())?.rate, 100);
  assert.equal((await pendingRefund())?.cause, "host_cancel");
});

async function subscription(userId: string) {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: `https://push.example.invalid/${randomUUID()}`,
      p256dh: "a".repeat(87),
      auth: "b".repeat(22),
      vapidPublicKey: "c".repeat(87),
    })
    .returning();
  return row!.id;
}
test("change alerts use a durable deduplicated push outbox and respect participation opt-out", async () => {
  await app(bob);
  const aliceSubscription = await subscription(alice);
  await subscription(bob);
  await db.insert(pushPreferences).values({ userId: bob, participation: false });
  await service.change(owner, postId, change());
  const deliveries = await db
    .select()
    .from(pushDeliveries)
    .where(eq(pushDeliveries.postId, postId));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.subscriptionId, aliceSubscription);
  assert.equal(deliveries[0]?.kind, "participation");
  assert.equal(deliveries[0]?.status, "pending");
  await assert.rejects(service.change(owner, postId, change()), code("CONFLICT"));
  assert.equal(
    (await db.select().from(pushDeliveries).where(eq(pushDeliveries.postId, postId))).length,
    1,
  );
});

test("cancelled external paid applications retain their verified receipt and queue a full request", async () => {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: "외부 결제 행사 취소",
      bodyMarkdown: "외부에서 결제된 행사의 취소를 검증합니다.",
      applicationUrl: "https://events.example.invalid/apply",
    })
    .returning();
  postId = post!.id;
  await db.insert(base.eventSettings).values({
    postId,
    amountKRW: 10001,
    capacity: 20,
    startsAt: originalStart,
    endsAt: originalEnd,
  });
  const [record] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: alice,
      source: "external",
      externalReference: "fake-external-order",
      attendeeName: "외부 참가자",
      contact: "test@example.invalid",
      amountKRW: 10001,
      status: "pending_approval",
      refundConsentAt: now,
    })
    .returning();
  applicationId = record!.id;
  await db.insert(base.externalReceipts).values({
    applicationId,
    postId,
    reference: "fake-external-order",
    amountKRW: 10001,
    provider: "test-provider",
    verification: "manual",
    verifiedBy: owner,
    state: "paid",
  });
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: now })
    .where(eq(base.eventApplications.id, applicationId));
  await service.change(owner, postId, change("cancel"));
  assert.equal((await pendingRefund())?.rate, 100);
  assert.equal((await pendingRefund())?.cause, "host_cancel");
  const [receipt] = await db
    .select()
    .from(base.externalReceipts)
    .where(eq(base.externalReceipts.applicationId, applicationId));
  assert.equal(receipt?.state, "paid");
  assert.equal(receipt?.refundedAmountKRW, null);
  assert.equal((await application()).status, "confirmed");
});

test("full reschedule refund eligibility ends once a participant enters the event", async () => {
  await paid();
  await service.change(owner, postId, change());
  assert.equal((await refunds.overview(alice, postId)).quote?.rate, 100);
  await db
    .insert(eventAdmissions)
    .values({ applicationId, postId, userId: alice, checkedBy: owner, checkedAt: now });
  assert.ok((await refunds.overview(alice, postId)).quote!.rate < 100);
  await refunds.request(alice, postId, { applicationId, reason: "참가 이후 취소 요청" });
  assert.equal((await pendingRefund())?.cause, "participant");
});

test("notice pagination and unread counts are scoped to the affected member and read only the chosen change", async () => {
  await service.change(owner, postId, change());
  await service.change(owner, postId, {
    ...change("reschedule", 1),
    startsAt: new Date(originalStart.getTime() + 2 * 86400000).toISOString(),
    endsAt: new Date(originalEnd.getTime() + 2 * 86400000).toISOString(),
  });
  const all = await service.notices(alice);
  assert.equal(all.items.length, 2);
  assert.equal(all.unread, 2);
  assert.equal((await service.notices(outsider)).unread, 0);
  await service.markRead(alice, postId, { changeId: all.items[0]!.id });
  const remaining = await service.notices(alice);
  assert.equal(remaining.unread, 1);
  assert.equal(remaining.items.filter((item) => item.readAt !== null).length, 1);
  await assert.rejects(service.notices(alice, 0));
  await assert.rejects(service.notices(null), code("UNAUTHENTICATED"));
});

test("the push worker delivers an event-change notice even when host cancellation ends an unpaid application", async () => {
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  const config = {
    subject: "mailto:test@example.invalid",
    publicKey: vapid.getPublicKey().toString("base64url"),
    privateKey: vapid.getPrivateKey().toString("base64url"),
  };
  for (const userId of [alice, bob]) {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint: `https://web.push.apple.com/fixture/${randomUUID()}`,
      p256dh: browser.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
      vapidPublicKey: config.publicKey,
    });
  }
  const unpaid = await app(bob, postId, 0, "pending_payment");
  await service.change(owner, postId, change("cancel"));
  const [unpaidState] = await db
    .select()
    .from(base.eventApplications)
    .where(eq(base.eventApplications.id, unpaid));
  assert.equal(unpaidState?.status, "cancelled");
  const sent: string[] = [];
  const worker = pushDispatcher(connection, config, async (_subscription, delivery) => {
    assert.equal(delivery.url, "/participation");
    sent.push(delivery.recipientId);
  });
  assert.equal((await worker.drain()).processed, 2);
  assert.deepEqual(sent.sort(), [alice, bob].sort());
  assert.equal((await worker.drain()).processed, 0);
  const rows = await db.select().from(pushDeliveries).where(eq(pushDeliveries.postId, postId));
  assert.ok(rows.every((row) => row.status === "sent"));
});

test("cancelling one event never changes a paid external participant in another event", async () => {
  const [otherPost] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: "변경 대상이 아닌 외부 행사",
      bodyMarkdown: "다른 행사의 참가 내역은 그대로 유지됩니다.",
      applicationUrl: "https://events.example.invalid/apply",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: otherPost!.id,
    amountKRW: 10001,
    capacity: 20,
    startsAt: originalStart,
    endsAt: originalEnd,
  });
  const [otherApp] = await db
    .insert(base.eventApplications)
    .values({
      postId: otherPost!.id,
      userId: bob,
      source: "external",
      externalReference: "unaffected-external-order",
      attendeeName: "다른 행사 참가자",
      contact: "test@example.invalid",
      amountKRW: 10001,
      status: "pending_approval",
      refundConsentAt: now,
    })
    .returning();
  await db.insert(base.externalReceipts).values({
    applicationId: otherApp!.id,
    postId: otherPost!.id,
    reference: "unaffected-external-order",
    amountKRW: 10001,
    provider: "test-provider",
    verification: "manual",
    verifiedBy: owner,
    state: "paid",
  });
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: now })
    .where(eq(base.eventApplications.id, otherApp!.id));
  await service.change(owner, postId, change("cancel"));
  const [untouched] = await db
    .select()
    .from(base.eventApplications)
    .where(eq(base.eventApplications.id, otherApp!.id));
  assert.equal(untouched?.status, "confirmed");
  assert.equal(
    (
      await db
        .select()
        .from(base.refundRequests)
        .where(eq(base.refundRequests.applicationId, otherApp!.id))
    ).length,
    0,
  );
});

test("rescheduling upgrades an existing ordinary pending request to a full refund without overwriting its original quote", async () => {
  await paid();
  await refunds.request(alice, postId, { applicationId, reason: "개인 사정 취소 요청" });
  const original = await pendingRefund();
  assert.ok(original && original.rate < 100);
  await service.change(owner, postId, change());
  const requests = await db
    .select()
    .from(base.refundRequests)
    .where(eq(base.refundRequests.applicationId, applicationId));
  const historical = requests.find((row) => row.id === original.id),
    current = requests.find((row) => row.state === "pending");
  assert.equal(historical?.state, "rejected");
  assert.equal(historical?.cause, "participant");
  assert.equal(historical?.rate, original.rate);
  assert.equal(historical?.refundableKRW, original.refundableKRW);
  assert.ok(historical?.decisionNote);
  assert.equal(current?.cause, "schedule_change");
  assert.equal(current?.rate, 100);
  assert.equal(current?.refundableKRW, 10001);
  assert.equal((await application()).status, "confirmed");
});
