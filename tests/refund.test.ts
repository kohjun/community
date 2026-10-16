import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  refundQuote,
  koreanDateTimeInput,
  koreanDateTimeISO,
  formatKoreanDate,
  formatKoreanDateTime,
} from "../src/domain/refund";
import { communityService } from "../src/server/community-service";
import { participationService } from "../src/server/participation-service";
import { refundService } from "../src/server/refund-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  service = participationService(db as unknown as Database),
  refund = refundService(db as unknown as Database),
  community = communityService(db as unknown as Database);
const code = (c: string) => (e: unknown) => e instanceof AppError && e.code === c;
let owner: string, attendee: string, other: string, postId: string, start: string;
const details = {
  consent: true,
  refundConsent: true,
};
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = randomUUID();
  attendee = randomUUID();
  other = randomUUID();
  for (const [id, nickname] of [
    [owner, "호스트"],
    [attendee, "참가자"],
    [other, "다른유저"],
  ]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({
      id: id!,
      nickname: nickname!,
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    });
  }
  postId = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "환불 테스트 이벤트",
      bodyMarkdown: "오프라인 게임",
      location: "서울",
      eventDate: "다가오는 토요일",
      eventFee: "10001원",
      isAnonymous: false,
      imageAssetIds: [],
    })
  ).id;
  start = new Date(Date.now() + 4 * 86400000).toISOString();
  await service.configure(owner, postId, {
    amountKRW: 10001,
    capacity: 5,
    open: true,
    startsAt: start,
    endsAt: new Date(Date.parse(start) + 3600000).toISOString(),
  });
});
after(() => pg.close());
async function paid() {
  const app = (await service.apply(attendee, postId, details, "bridge")).application!;
  await service.payment("bridge", {
    eventId: randomUUID(),
    orderId: app.orderId!,
    paymentId: `receipt-${app.id}`,
    amountKRW: 10001,
    currency: "KRW",
    status: "paid",
  });
  return app;
}
test("refund percentages follow Korean calendar dates and include the entire fifth day", () => {
  const event = new Date("2026-10-10T10:00:00+09:00");
  for (const [at, rate] of [
    ["2026-10-05T23:59:59+09:00", 100],
    ["2026-10-06T00:00:00+09:00", 80],
    ["2026-10-07T18:00:00+09:00", 60],
    ["2026-10-08T23:00:00+09:00", 40],
    ["2026-10-09T00:00:00+09:00", 20],
    ["2026-10-10T00:00:00+09:00", 0],
    ["2026-10-11T00:00:00+09:00", 0],
  ] as const)
    assert.equal(refundQuote(10001, event, new Date(at)).rate, rate);
  assert.equal(
    refundQuote(10001, event, new Date("2026-10-06T00:00:00+09:00")).refundableKRW,
    8000,
  );
});
test("Korean schedule inputs remain stable regardless of browser timezone", () => {
  assert.equal(koreanDateTimeInput("2026-10-10T01:30:00.000Z"), "2026-10-10T10:30");
  assert.equal(koreanDateTimeISO("2026-10-10T10:30"), "2026-10-10T01:30:00.000Z");
});
test("Korean display dates use the same numeric 24-hour text across device timezones and explicit offsets", () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Seoul", "America/Los_Angeles", "Pacific/Honolulu"]) {
      process.env.TZ = timezone;
      assert.equal(formatKoreanDateTime("2026-10-22T03:22:19.000Z"), "2026. 10. 22. 12:22:19");
      assert.equal(formatKoreanDateTime("2026-10-21T20:22:19-07:00"), "2026. 10. 22. 12:22:19");
      assert.equal(formatKoreanDate(new Date("2026-10-21T15:00:00.000Z")), "2026. 10. 22.");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("Korean display date boundaries preserve midnight, year and leap-day changes", () => {
  for (const [instant, expected] of [
    ["2026-12-31T14:59:59Z", "2026. 12. 31. 23:59:59"],
    ["2026-12-31T15:00:00Z", "2027. 01. 01. 00:00:00"],
    ["2028-02-28T15:00:00Z", "2028. 02. 29. 00:00:00"],
    ["2028-02-29T15:00:00Z", "2028. 03. 01. 00:00:00"],
  ])
    assert.equal(formatKoreanDateTime(instant), expected);
  for (const missing of [undefined, null, "", "invalid", "2026-10-22T12:22:19", new Date(NaN)]) {
    assert.equal(formatKoreanDateTime(missing), "");
    assert.equal(formatKoreanDate(missing), "");
  }
});

test("scheduled paid applications require policy consent and retain immutable schedule snapshots", async () => {
  await assert.rejects(
    service.apply(attendee, postId, { ...details, refundConsent: false }, "bridge"),
    code("VALIDATION"),
  );
  const app = await paid();
  assert.equal(app.eventStartsAt, start);
  await assert.rejects(
    service.configure(owner, postId, {
      amountKRW: 10001,
      capacity: 5,
      open: true,
      startsAt: new Date(Date.parse(start) + 86400000).toISOString(),
      endsAt: new Date(Date.parse(start) + 86400000 + 3600000).toISOString(),
    }),
    code("CONFLICT"),
  );
  await assert.rejects(
    db
      .update(schema.eventApplications)
      .set({ eventStartsAt: new Date() })
      .where(eq(schema.eventApplications.id, app.id)),
  );
});
test("refund requests are member-scoped, idempotent and cannot forge the recorded quote", async () => {
  const app = await paid();
  await assert.rejects(
    refund.request(other, postId, { applicationId: app.id, reason: "취소" }),
    code("NOT_FOUND"),
  );
  const first = await refund.request(attendee, postId, {
      applicationId: app.id,
      reason: "일정 변경",
    }),
    again = await refund.request(attendee, postId, { applicationId: app.id, reason: "다시요청" });
  assert.equal(first.requests.length, 1);
  assert.equal(again.requests[0]?.id, first.requests[0]?.id);
  assert.equal(first.requests[0]?.rate, 80);
  assert.equal(first.requests[0]?.refundableKRW, 8000);
  await assert.rejects(
    db
      .update(schema.refundRequests)
      .set({ rate: 100, refundableKRW: 10001 })
      .where(eq(schema.refundRequests.id, first.requests[0]!.id)),
  );
  await assert.rejects(refund.overview(other, postId, true), code("FORBIDDEN"));
  assert.equal((await refund.overview(other, postId)).requests.length, 0);
});
test("only verified host processing closes participation after the exact partial refund", async () => {
  const app = await paid(),
    result = await refund.request(attendee, postId, { applicationId: app.id, reason: "일정 변경" }),
    id = result.requests[0]!.id;
  await assert.rejects(
    refund.resolve(attendee, id, {
      decision: "complete",
      externalRefundChecked: true,
      actualRefundKRW: 8000,
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    refund.resolve(owner, id, {
      decision: "complete",
      externalRefundChecked: false,
      actualRefundKRW: 8000,
    }),
  );
  await assert.rejects(
    refund.resolve(owner, id, {
      decision: "complete",
      externalRefundChecked: true,
      actualRefundKRW: 10001,
    }),
    code("VALIDATION"),
  );
  await refund.resolve(owner, id, {
    decision: "complete",
    externalRefundChecked: true,
    actualRefundKRW: 8000,
    reason: "외부 환불 완료",
  });
  await refund.resolve(owner, id, {
    decision: "complete",
    externalRefundChecked: true,
    actualRefundKRW: 8000,
  });
  const [order] = await db
    .select()
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, app.orderId!));
  assert.equal(order?.refundedAmountKRW, 8000);
  assert.equal((await refund.overview(attendee, postId)).requests[0]?.state, "completed");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
});
test("verified partial refund callbacks complete pending requests and do not restore room access", async () => {
  const app = await paid();
  await refund.request(attendee, postId, { applicationId: app.id, reason: "취소 요청" });
  const callback = {
    eventId: randomUUID(),
    orderId: app.orderId!,
    paymentId: `receipt-${app.id}`,
    amountKRW: 10001,
    refundAmountKRW: 8000,
    currency: "KRW",
    status: "refunded",
  };
  await service.payment("bridge", callback);
  await assert.rejects(
    service.payment("bridge", { ...callback, eventId: randomUUID(), refundAmountKRW: 10001 }),
    code("CONFLICT"),
  );
  assert.equal((await refund.overview(attendee, postId)).requests[0]?.actualRefundKRW, 8000);
  await service.payment("bridge", {
    ...callback,
    eventId: randomUUID(),
    status: "paid",
    refundAmountKRW: undefined,
  });
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
});
test("a rejected request may be submitted again without editing the old quote", async () => {
  const app = await paid(),
    first = await refund.request(attendee, postId, { applicationId: app.id, reason: "취소 요청" });
  await refund.resolve(owner, first.requests[0]!.id, {
    decision: "reject",
    externalRefundChecked: false,
    reason: "플랫폼 내역 확인 필요",
  });
  const next = await refund.request(attendee, postId, {
    applicationId: app.id,
    reason: "외부내역 추가 확인",
  });
  assert.equal(next.requests.length, 2);
  assert.equal(next.requests.filter((x) => x.state === "pending").length, 1);
});

test("payments received after an event ends are recorded for review and cannot open the room", async () => {
  const startsAt = new Date(Date.now() + 1200).toISOString(),
    endsAt = new Date(Date.now() + 2300).toISOString();
  await service.configure(owner, postId, {
    amountKRW: 10001,
    capacity: 5,
    open: true,
    startsAt,
    endsAt,
  });
  const app = (await service.apply(attendee, postId, details, "bridge")).application!;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await assert.rejects(service.checkoutOrder(attendee, app.orderId!), code("CONFLICT"));
  const result = await service.payment("bridge", {
    eventId: randomUUID(),
    orderId: app.orderId!,
    paymentId: `receipt-${app.id}`,
    amountKRW: 10001,
    currency: "KRW",
    status: "paid",
  });
  assert.equal(result.status, "review");
  const [order] = await db
    .select()
    .from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.id, app.orderId!));
  assert.equal(order?.state, "paid");
  await assert.rejects(service.room(attendee, postId), code("FORBIDDEN"));
});

test("conflicting external refund totals are rejected without changing the prior receipt", async () => {
  const post = await community.getPost(postId, owner);
  await community.updatePost(owner, {
    postId,
    expectedUpdatedAt: post.updatedAt,
    categorySlug: "party",
    kind: "모집",
    title: "외부 환불 테스트",
    bodyMarkdown: "외부 플랫폼에서 신청과 결제를 완료합니다.",
    applicationUrl: "https://example.com/event",
    isAnonymous: false,
    imageAssetIds: [],
  });
  await service.configure(owner, postId, {
    amountKRW: 10001,
    capacity: 5,
    open: true,
    approvalMode: "automatic",
  });
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, attendee));
  const base = {
    eventId: randomUUID(),
    postId,
    publicProfileId: profile!.publicId,
    externalReference: "order-ext",
    attendeeName: "참가자",
    contact: "test@example.invalid",
    amountKRW: 10001,
    currency: "KRW",
    status: "paid",
  };
  await service.externalPayment("platform", base);
  await service.externalPayment("platform", {
    ...base,
    eventId: randomUUID(),
    status: "refunded",
    refundAmountKRW: 8000,
  });
  await assert.rejects(
    service.externalPayment("platform", {
      ...base,
      eventId: randomUUID(),
      status: "refunded",
      refundAmountKRW: 10001,
    }),
    code("CONFLICT"),
  );
  const [receipt] = await db
    .select()
    .from(schema.externalReceipts)
    .where(eq(schema.externalReceipts.postId, postId));
  assert.equal(receipt?.refundedAmountKRW, 8000);
});
