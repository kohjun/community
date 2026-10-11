import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";
import { verifyPaymentSignature } from "../src/server/payment-signature";
const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  service = participationService(db as unknown as Database),
  community = communityService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const details = {
  note: "처음 참가해요",
  consent: true,
};
let owner: string, attendee: string, outsider: string, staff: string, postId: string;
async function member(name: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({
    id,
    nickname: name,
    phoneNumber: "01012345678",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
  return id;
}
async function configure(amountKRW = 10000, capacity = 2) {
  await service.configure(owner, postId, { amountKRW, capacity, open: true });
}
async function apply(actor = attendee) {
  return (await service.apply(actor, postId, details, "bridge")).application!;
}
async function callback(
  orderId: string,
  status: "paid" | "refunded" = "paid",
  extra: Record<string, unknown> = {},
) {
  return service.payment("bridge", {
    eventId: `${status}-${orderId}`,
    orderId,
    paymentId: `receipt-${orderId}`,
    amountKRW: 10000,
    currency: "KRW",
    status,
    ...extra,
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("등록자");
  attendee = await member("참가자");
  outsider = await member("외부회원");
  staff = await member("운영담당자");
  postId = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "참가 테스트 행사",
      bodyMarkdown: "함께 즐기는 예능",
      location: "서울",
      eventDate: "토요일 14시",
      eventFee: "만원",
      isAnonymous: true,
      imageAssetIds: [],
    })
  ).id;
});
after(() => pg.close());

test("raw-byte signatures reject tampering, expired/future timestamps, malformed signatures and short secrets", () => {
  const body = Buffer.from('{"order":"abc"}'),
    timestamp = "1790800000",
    secret = "a-test-only-secret-at-least-32-characters";
  const signature = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(body)
    .digest("hex");
  assert.equal(verifyPaymentSignature(body, timestamp, signature, secret, 1790800000), true);
  for (const [raw, time, sig, key] of [
    [Buffer.from('{ "order":"abc"}'), timestamp, signature, secret],
    [body, "1790800400", signature, secret],
    [body, "1790799600", signature, secret],
    [body, timestamp, "bad", secret],
    [body, timestamp, signature, "short"],
  ] as const)
    assert.equal(verifyPaymentSignature(raw, time, sig, key, 1790800000), false);
});
test("only recruitment owner configures registration; anonymous users and forged client prices cannot apply", async () => {
  await assert.rejects(
    service.configure(outsider, postId, { amountKRW: 10000, capacity: 2, open: true }),
    code("FORBIDDEN"),
  );
  await configure();
  await assert.rejects(service.apply(null, postId, details, "bridge"), code("UNAUTHENTICATED"));
  await assert.rejects(service.apply(attendee, postId, { ...details, amountKRW: 0 }, "bridge"));
  await assert.rejects(service.apply(attendee, postId, { ...details, consent: false }, "bridge"));
  await assert.rejects(service.apply(attendee, postId, details, null), code("CONFLICT"));
  assert.equal((await service.overview(outsider, postId)).config?.occupied, 0);
});
test("free applications are confirmed and invited atomically; duplicate submissions do not add applications", async () => {
  await configure(0, 2);
  const one = await apply(),
    two = await apply();
  assert.equal(one.id, two.id);
  assert.equal(one.status, "confirmed");
  assert.equal(one.orderId, null);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  assert.equal((await service.home(attendee)).rooms.length, 1);
  await service.cancel(attendee, one.id);
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  assert.equal((await service.home(attendee)).rooms.length, 0);
  const again = await apply();
  assert.notEqual(again.id, one.id);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
});
test("paid applicants cannot join until the server confirms the correct provider, amount and currency", async () => {
  await configure();
  const app = await apply();
  assert.equal(app.status, "pending_payment");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await assert.rejects(
    service.payment("forged-provider", {
      eventId: "x",
      orderId: app.orderId!,
      paymentId: "x",
      amountKRW: 10000,
      currency: "KRW",
      status: "paid",
    }),
    code("NOT_FOUND"),
  );
  await assert.rejects(callback(app.orderId!, "paid", { amountKRW: 1 }), code("CONFLICT"));
  await assert.rejects(callback(app.orderId!, "paid", { currency: "USD" }));
  assert.equal((await service.overview(attendee, postId)).application?.status, "pending_payment");
  assert.equal((await callback(app.orderId!)).status, "confirmed");
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  await assert.rejects(service.cancel(attendee, app.id), code("CONFLICT"));
});
test("duplicate and out-of-order callbacks cannot re-invite refunded participants", async () => {
  await configure();
  const app = await apply();
  await callback(app.orderId!);
  assert.equal((await callback(app.orderId!)).duplicate, true);
  await assert.rejects(
    callback(app.orderId!, "paid", { paymentId: "different-payment" }),
    code("CONFLICT"),
  );
  await callback(app.orderId!, "refunded");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await callback(app.orderId!, "paid", { eventId: "late-paid" });
  assert.equal((await service.overview(attendee, postId)).application?.status, "refunded");
  const again = await apply();
  await callback(again.orderId!, "refunded");
  await callback(again.orderId!);
  assert.equal((await service.overview(attendee, postId)).application?.status, "refunded");
  assert.equal((await service.home(attendee)).rooms.length, 0);
});
test("cancelled or expired reservations do not receive invitations for late payments", async () => {
  await configure(10000, 1);
  const app = await apply();
  await service.cancel(attendee, app.id);
  const replacement = await apply(outsider);
  assert.equal((await callback(app.orderId!)).status, "review");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  assert.equal((await callback(replacement.orderId!)).status, "confirmed");
  await assert.rejects(
    service
      .configure(owner, postId, { amountKRW: 10000, capacity: 1, open: true })
      .then(() => service.apply(staff, postId, details, "bridge")),
    code("CONFLICT"),
  );
});
test("capacity and price changes apply safely to existing reservations", async () => {
  await configure(10000, 1);
  const app = await apply();
  await assert.rejects(apply(outsider), code("CONFLICT"));
  await service.configure(owner, postId, { amountKRW: 5000, capacity: 2, open: true });
  const next = await apply(outsider);
  assert.equal(next.amountKRW, 5000);
  assert.equal((await callback(app.orderId!)).status, "confirmed");
  await assert.rejects(
    service.configure(owner, postId, { amountKRW: 5000, capacity: 1, open: true }),
    code("CONFLICT"),
  );
});
test("participants cannot write announcements or see contacts; only owner can grant and revoke managers", async () => {
  await configure();
  const app = await apply();
  await callback(app.orderId!);
  await assert.rejects(service.send(attendee, postId, { body: "unauthorized" }), code("FORBIDDEN"));
  await assert.rejects(service.attendees(attendee, postId), code("FORBIDDEN"));
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, staff));
  await assert.rejects(
    service.setManager(attendee, postId, { publicId: profile!.publicId, enabled: true }),
    code("FORBIDDEN"),
  );
  await service.setManager(owner, postId, { publicId: profile!.publicId, enabled: true });
  const room = await service.send(staff, postId, { body: "## 준비물\n물 한 병을 준비해주세요." });
  assert.equal(room.canWrite, true);
  assert.equal((await service.room(attendee, postId)).messages.length, 1);
  assert.equal((await service.attendees(staff, postId)).items[0]?.contact, "01012345678");
  const safe = JSON.stringify(await service.room(attendee, postId));
  for (const privateValue of [owner, staff, attendee, "01012345678", details.note])
    assert.equal(safe.includes(privateValue), false);
  await service.setManager(owner, postId, { publicId: profile!.publicId, enabled: false });
  await assert.rejects(service.room(staff, postId), code("FORBIDDEN"));
  await assert.rejects(
    service.send(staff, postId, { body: "no longer a manager" }),
    code("FORBIDDEN"),
  );
  await assert.rejects(service.attendees(staff, postId), code("FORBIDDEN"));
});
test("DB guards reject unpaid invitations, non-manager messages, forged amounts and active-event deletion", async () => {
  await configure();
  const app = await apply();
  await assert.rejects(
    db
      .update(schema.eventApplications)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(schema.eventApplications.id, app.id)),
  );
  await assert.rejects(
    db.insert(schema.roomMembers).values({ postId, userId: attendee, applicationId: app.id }),
  );
  await assert.rejects(
    db.insert(schema.roomMessages).values({ postId, authorId: attendee, body: "bypass" }),
  );
  await assert.rejects(
    db
      .update(schema.paymentOrders)
      .set({ amountKRW: 1 })
      .where(eq(schema.paymentOrders.id, app.orderId!)),
  );
  await assert.rejects(community.deletePost(owner, postId), code("CONFLICT"));
  await assert.rejects(
    db.update(schema.posts).set({ status: "deleted" }).where(eq(schema.posts.id, postId)),
  );
});
test("private list cursors are bounded and do not expose other users' applications", async () => {
  await configure(0, 3);
  await apply();
  await apply(outsider);
  assert.equal((await service.overview(outsider, postId)).application?.attendeeName, "외부회원");
  assert.equal((await service.home(attendee)).applications.length, 1);
  await assert.rejects(service.home(attendee, "bad cursor"), code("VALIDATION"));
  await assert.rejects(service.attendees(outsider, postId), code("FORBIDDEN"));
  await assert.rejects(service.room(null, postId), code("UNAUTHENTICATED"));
});

test("expired holds release capacity and late payment stays in review without invitation", async () => {
  await configure(10000, 1);
  const id = randomUUID();
  await pg.query(
    "insert into sliper.event_applications(id,post_id,user_id,attendee_name,contact,amount_krw,expires_at) values($1,$2,$3,'기한만료','test-contact',10000,statement_timestamp()-interval '1 second')",
    [id, postId, attendee],
  );
  const [order] = await db
    .insert(schema.paymentOrders)
    .values({ applicationId: id, provider: "bridge", amountKRW: 10000 })
    .returning();
  assert.equal((await service.overview(attendee, postId)).application?.status, "expired");
  const replacement = await apply(outsider);
  assert.equal(replacement.status, "pending_payment");
  assert.equal((await callback(order!.id)).status, "review");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  assert.equal((await service.overview(outsider, postId)).config?.occupied, 1);
});

test("announcement pagination retains PostgreSQL microseconds and all history across boundaries", async () => {
  await configure(0, 1);
  await apply();
  const rows = Array.from({ length: 37 }, (_, index) => ({
    postId,
    authorId: owner,
    body: `공지 ${index}`,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  }));
  await db.insert(schema.roomMessages).values(rows);
  const ids = (await db.select({ id: schema.roomMessages.id }).from(schema.roomMessages)).map(
    (r) => r.id,
  );
  // Values intentionally share a millisecond but not a microsecond.
  // The messages are append-only; seed precise values directly through INSERT above,
  // then additionally seed two timestamps to exercise the precise cursor boundary.
  await pg.query(
    "insert into sliper.room_messages(post_id,author_id,body,created_at) values($1,$2,'micro 1','2026-10-01T00:00:00.000111Z'),($1,$2,'micro 2','2026-10-01T00:00:00.000222Z')",
    [postId, owner],
  );
  const first = await service.room(attendee, postId);
  assert.equal(first.messages.length, 30);
  assert.ok(first.nextCursor);
  const next = await service.room(attendee, postId, first.nextCursor);
  assert.equal(next.messages.length, 9);
  assert.equal(next.nextCursor, null);
  const union = new Set([...first.messages, ...next.messages].map((m) => m.id));
  assert.equal(union.size, 39);
  for (const id of ids) assert.ok(union.has(id));
});

async function externalEvent(approvalMode: "manual" | "automatic" = "manual", capacity = 3) {
  const post = await community.getPost(postId, owner);
  await community.updatePost(owner, {
    postId,
    expectedUpdatedAt: post.updatedAt,
    categorySlug: "party",
    kind: "모집",
    title: "외부 참가 행사",
    bodyMarkdown: "외부 플랫폼에서 신청해요",
    applicationUrl: "https://example.com/external-apply",
    isAnonymous: true,
    imageAssetIds: [],
  });
  await service.configure(owner, postId, { amountKRW: 10000, capacity, open: true, approvalMode });
}
async function externalClaim(actor = attendee, reference = "external-order-01") {
  return (await service.claimExternal(actor, postId, { ...details, externalReference: reference }))
    .application!;
}
async function externalCallback(
  actor = attendee,
  reference = "external-order-01",
  status: "paid" | "refunded" = "paid",
  extra: Record<string, unknown> = {},
) {
  const [profile] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, actor));
  return service.externalPayment("external-platform", {
    eventId: `${status}-${actor}-${reference}`,
    postId,
    publicProfileId: profile!.publicId,
    externalReference: reference,
    attendeeName: "외부 참가자",
    contact: "private-external-contact",
    amountKRW: 10000,
    currency: "KRW",
    status,
    ...extra,
  });
}
const approve = { decision: "approve", paymentChecked: true, reason: "외부 결제 내역 확인" };
test("external-link events reject internal registration even when nominally free", async () => {
  await externalEvent();
  await assert.rejects(service.apply(attendee, postId, details, "local-test"), code("CONFLICT"));
  await service.configure(owner, postId, { amountKRW: 0, capacity: 3, open: true });
  await assert.rejects(service.apply(attendee, postId, details, null), code("CONFLICT"));
  assert.equal((await service.overview(attendee, postId)).application, null);
});
test("external confirmation requests neither charge nor invite, are idempotent and require consent", async () => {
  await externalEvent();
  await assert.rejects(
    service.claimExternal(attendee, postId, {
      ...details,
      externalReference: "external-order-01",
      consent: false,
    }),
  );
  const app = await externalClaim(),
    again = await externalClaim();
  assert.equal(app.id, again.id);
  assert.equal(app.status, "pending_approval");
  assert.equal(app.source, "external");
  assert.equal(app.expiresAt, null);
  assert.equal(app.orderId, null);
  assert.equal(app.externalPaymentVerified, false);
  assert.equal((await service.overview(attendee, postId)).config?.occupied, 0);
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await assert.rejects(
    db
      .update(schema.eventApplications)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(schema.eventApplications.id, app.id)),
  );
  await assert.rejects(
    service.claimExternal(attendee, postId, { ...details, externalReference: "different-order" }),
    code("CONFLICT"),
  );
});
test("owner or appointed manager can approve only after acknowledging external payment", async () => {
  await externalEvent();
  const app = await externalClaim();
  await assert.rejects(service.decideExternal(attendee, app.id, approve), code("FORBIDDEN"));
  await assert.rejects(service.decideExternal(outsider, app.id, approve), code("FORBIDDEN"));
  await assert.rejects(
    service.decideExternal(owner, app.id, { ...approve, paymentChecked: false }),
  );
  await service.decideExternal(owner, app.id, approve);
  await service.decideExternal(owner, app.id, approve);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  const next = await externalClaim(outsider, "external-order-02"),
    [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, staff));
  await service.setManager(owner, postId, { publicId: profile!.publicId, enabled: true });
  await service.decideExternal(staff, next.id, approve);
  const summary = await service.dashboard(owner, postId);
  assert.equal(summary.stats.confirmed, 2);
  assert.equal(summary.stats.pendingApproval, 0);
  assert.equal(
    summary.attendees.every((row) => row.externalPaymentVerified),
    true,
  );
});
test("rejecting a confirmation returns a reason and cancellation does not cancel the external purchase", async () => {
  await externalEvent();
  const app = await externalClaim();
  await assert.rejects(
    service.decideExternal(owner, app.id, {
      decision: "reject",
      paymentChecked: false,
      reason: "",
    }),
  );
  await service.decideExternal(owner, app.id, {
    decision: "reject",
    paymentChecked: false,
    reason: "신청 번호를 다시 확인해주세요",
  });
  assert.equal((await service.overview(attendee, postId)).application?.status, "rejected");
  const again = await externalClaim(attendee, "corrected-order");
  assert.notEqual(again.id, app.id);
  await service.cancel(attendee, again.id);
  assert.equal((await service.overview(attendee, postId)).application?.status, "cancelled");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
});
test("one external order cannot be approved for two different members", async () => {
  await externalEvent();
  const first = await externalClaim(),
    second = await externalClaim(outsider);
  await service.decideExternal(owner, first.id, approve);
  await assert.rejects(service.decideExternal(owner, second.id, approve), code("CONFLICT"));
  await assert.rejects(service.room(outsider, postId), code("FORBIDDEN"));
});
test("verified automatic callbacks can create participation without a Sliper registration form", async () => {
  await externalEvent("automatic");
  const result = await externalCallback();
  assert.equal(result.status, "confirmed");
  const app = (await service.overview(attendee, postId)).application!;
  assert.equal(app.source, "external");
  assert.equal(app.orderId, null);
  assert.equal(app.externalPaymentVerified, true);
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  assert.equal((await externalCallback()).duplicate, true);
  await assert.rejects(
    externalCallback(attendee, "external-order-01", "paid", { contact: "changed-data" }),
    code("CONFLICT"),
  );
});
test("manual approval mode does not automatically invite even after a verified payment callback", async () => {
  await externalEvent("manual");
  await externalCallback();
  const app = (await service.overview(attendee, postId)).application!;
  assert.equal(app.status, "pending_approval");
  assert.equal(app.externalPaymentVerified, true);
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await assert.rejects(
    service.decideExternal(owner, app.id, {
      decision: "reject",
      paymentChecked: false,
      reason: "반려",
    }),
    code("CONFLICT"),
  );
  await service.decideExternal(owner, app.id, approve);
  assert.equal((await service.overview(attendee, postId)).application?.status, "confirmed");
});
test("automatic capacity overflow remains recorded for review; manual approval cannot overbook", async () => {
  await externalEvent("automatic", 1);
  await externalCallback();
  const next = await externalCallback(outsider, "external-order-02");
  assert.equal(next.status, "review");
  const app = (await service.overview(outsider, postId)).application!;
  assert.equal(app.externalPaymentVerified, true);
  await assert.rejects(service.decideExternal(owner, app.id, approve), code("CONFLICT"));
  await service.configure(owner, postId, {
    amountKRW: 10000,
    capacity: 2,
    open: true,
    approvalMode: "automatic",
  });
  await service.decideExternal(owner, app.id, approve);
  assert.equal((await service.room(outsider, postId)).canWrite, false);
});
test("external refunds, including refund-before-paid, revoke access and never get reversed by late callbacks", async () => {
  await externalEvent("automatic");
  await externalCallback();
  await externalCallback(attendee, "external-order-01", "refunded");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  await externalCallback(attendee, "external-order-01", "paid", { eventId: "late-paid-event" });
  assert.equal((await service.overview(attendee, postId)).application?.status, "refunded");
  await externalCallback(outsider, "external-order-02", "refunded");
  await externalCallback(outsider, "external-order-02", "paid");
  assert.equal((await service.overview(outsider, postId)).application?.status, "refunded");
});
test("manual refund confirmation revokes a previously approved participant", async () => {
  await externalEvent();
  const app = await externalClaim();
  await service.decideExternal(owner, app.id, approve);
  await assert.rejects(
    service.decideExternal(owner, app.id, {
      decision: "refund",
      paymentChecked: false,
      reason: "",
    }),
  );
  await service.decideExternal(owner, app.id, {
    decision: "refund",
    paymentChecked: true,
    reason: "외부 환불 확인",
  });
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
  assert.equal((await service.dashboard(owner, postId)).stats.refunded, 1);
});
test("event dashboards remain private, filter applicants and expose only owned or managed events", async () => {
  await externalEvent();
  const first = await externalClaim(),
    second = await externalClaim(outsider, "external-order-02");
  await service.decideExternal(owner, first.id, approve);
  await assert.rejects(service.dashboard(attendee, postId), code("FORBIDDEN"));
  assert.equal((await service.managedEvents(attendee)).items.length, 0);
  assert.equal((await service.managedEvents(owner)).items[0]?.postId, postId);
  const pending = await service.dashboard(owner, postId, {
    status: "pending_approval",
    search: "external-order-02",
  });
  assert.equal(pending.attendees.length, 1);
  assert.equal(pending.attendees[0]?.id, second.id);
  assert.equal(pending.stats.confirmed, 1);
  await assert.rejects(community.deletePost(owner, postId), code("CONFLICT"));
});
test("unmatched members, wrong amounts and private auth IDs cannot stand in for platform member mapping", async () => {
  await externalEvent("automatic");
  await assert.rejects(
    externalCallback(attendee, "external-order-01", "paid", { publicProfileId: attendee }),
    code("NOT_FOUND"),
  );
  await assert.rejects(
    externalCallback(attendee, "external-order-01", "paid", { amountKRW: 1 }),
    code("CONFLICT"),
  );
  assert.equal((await service.overview(attendee, postId)).application, null);
});

test("dashboard pagination remains reachable and cursors are bound to filters and staff identity", async () => {
  await externalEvent("manual", 50);
  for (let index = 0; index < 34; index++) {
    const actor = await member(`외부참가${index}`);
    await externalClaim(actor, `page-order-${String(index).padStart(3, "0")}`);
  }
  const first = await service.dashboard(owner, postId);
  assert.equal(first.attendees.length, 30);
  assert.ok(first.nextCursor);
  const next = await service.dashboard(owner, postId, { cursor: first.nextCursor });
  assert.equal(next.attendees.length, 4);
  assert.equal(new Set([...first.attendees, ...next.attendees].map((a) => a.id)).size, 34);
  await assert.rejects(
    service.dashboard(owner, postId, { status: "confirmed", cursor: first.nextCursor }),
    code("VALIDATION"),
  );
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, staff));
  await service.setManager(owner, postId, { publicId: profile!.publicId, enabled: true });
  await assert.rejects(
    service.dashboard(staff, postId, { cursor: first.nextCursor }),
    code("VALIDATION"),
  );
});

test("late external payments remain auditable when the member has a replacement request", async () => {
  await externalEvent("automatic");
  for (const [actor, terminal] of [
    [attendee, "cancelled"],
    [outsider, "rejected"],
  ] as const) {
    const old = await externalClaim(actor, `old-${terminal}`);
    if (terminal === "cancelled") await service.cancel(actor, old.id);
    else
      await service.decideExternal(owner, old.id, {
        decision: "reject",
        paymentChecked: false,
        reason: "신청 번호 확인 필요",
      });
    const replacement = await externalClaim(actor, `new-${terminal}`);
    assert.equal((await externalCallback(actor, `old-${terminal}`)).status, "review");
    const [receipt] = await db
      .select()
      .from(schema.externalReceipts)
      .where(eq(schema.externalReceipts.applicationId, old.id));
    assert.equal(receipt?.state, "paid");
    assert.equal((await externalCallback(actor, `old-${terminal}`)).duplicate, true);
    assert.equal((await service.overview(actor, postId)).application?.id, replacement.id);
    assert.equal((await externalClaim(actor, `new-${terminal}`)).id, replacement.id);
    await assert.rejects(service.room(actor, postId), code("FORBIDDEN"));
    await assert.rejects(service.decideExternal(owner, old.id, approve), code("CONFLICT"));
    await assert.rejects(
      db
        .update(schema.eventApplications)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(schema.eventApplications.id, old.id)),
    );
    await service.cancel(actor, replacement.id);
    await service.decideExternal(owner, old.id, approve);
    assert.equal((await service.room(actor, postId)).canWrite, false);
  }
});

test("a second signed external order is recorded for review without replacing confirmed participation", async () => {
  await externalEvent("automatic");
  await externalCallback();
  const original = (await service.overview(attendee, postId)).application!;
  assert.equal((await externalCallback(attendee, "second-paid-order")).status, "review");
  const dashboard = await service.dashboard(owner, postId);
  assert.equal(dashboard.stats.confirmed, 1);
  assert.equal(dashboard.stats.review, 1);
  const extra = dashboard.attendees.find((a) => a.externalReference === "second-paid-order")!;
  assert.equal(extra.externalPaymentVerified, true);
  assert.equal((await service.overview(attendee, postId)).application?.id, original.id);
  await assert.rejects(service.decideExternal(owner, extra.id, approve), code("CONFLICT"));
  assert.equal((await service.room(attendee, postId)).canWrite, false);
  await externalCallback(attendee, "second-paid-order", "refunded");
  assert.equal((await service.room(attendee, postId)).canWrite, false);
});

test("verified pending external payments cannot be cancelled or reused after refund", async () => {
  await externalEvent("manual");
  await externalCallback();
  const app = (await service.overview(attendee, postId)).application!;
  await assert.rejects(service.cancel(attendee, app.id), code("CONFLICT"));
  assert.equal((await service.overview(attendee, postId)).application?.status, "pending_approval");
  await service.decideExternal(owner, app.id, {
    decision: "refund",
    paymentChecked: true,
    reason: "외부 환불 완료 확인",
  });
  await assert.rejects(externalClaim(), code("CONFLICT"));
  assert.equal(
    (await externalClaim(attendee, "new-order-after-refund")).status,
    "pending_approval",
  );
});
