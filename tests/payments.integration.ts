import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import type { ActionResult } from "../src/domain/contracts";
const origin = "http://127.0.0.1:3001",
  provider = "integration-test",
  secret = "sliper-integration-only-webhook-secret-not-for-production";
if (process.env.LOCAL_DATABASE !== "1" || !process.env.DATABASE_URL)
  throw new Error("Requires isolated Sliper local database.");
const address = new URL(process.env.DATABASE_URL);
if (
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Unexpected database.");
async function webhook(
  body: unknown,
  signed = true,
  timestamp = Math.floor(Date.now() / 1000),
  path = "webhook",
) {
  const raw = JSON.stringify(body),
    time = String(timestamp),
    signature = createHmac("sha256", secret)
      .update(time + ".")
      .update(raw)
      .digest("hex");
  const response = await fetch(`${origin}/api/payments/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sliper-timestamp": time,
      "x-sliper-signature": signed ? signature : "0".repeat(64),
    },
    body: raw,
  });
  return {
    status: response.status,
    result: (await response.json()) as ActionResult<{ duplicate: boolean; status: string }>,
  };
}
test("production HTTP webhook rejects forged notifications and safely applies paid/refunded callbacks", async () => {
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    db = connection.db,
    service = participationService(db),
    owner = randomUUID(),
    participant = randomUUID();
  let postId: string | null = null;
  try {
    for (const [id, name] of [
      [owner, "웹훅등록자"],
      [participant, "웹훅참가자"],
    ] as const) {
      await db.execute(sql`insert into auth.users(id) values(${id})`);
      await db.insert(profiles).values({
        id,
        nickname: name,
        phoneNumber: "01012345678",
        profileCompletedAt: new Date(),
        onboardingConsentAt: new Date(),
      });
    }
    const post = await communityService(db).createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "[서명 웹훅 검증 전용]",
      bodyMarkdown: "테스트",
      location: "서울",
      eventDate: "토요일",
      eventFee: "만원",
      isAnonymous: true,
      imageAssetIds: [],
    });
    postId = post.id;
    await service.configure(owner, post.id, { amountKRW: 10000, capacity: 1, open: true });
    const app = (await service.apply(participant, post.id, { consent: true }, provider))
      .application!;
    const event = {
      eventId: `paid-${app.orderId}`,
      orderId: app.orderId!,
      paymentId: `payment-${app.orderId}`,
      amountKRW: 10000,
      currency: "KRW",
      status: "paid",
    };
    assert.equal((await webhook(event, false)).status, 403);
    assert.equal((await webhook(event, true, Math.floor(Date.now() / 1000) - 600)).status, 403);
    assert.equal((await webhook({ ...event, amountKRW: 1 })).status, 409);
    await assert.rejects(service.room(participant, post.id));
    const paid = await webhook(event);
    assert.equal(paid.status, 200);
    assert.equal(paid.result.ok && paid.result.data.status, "confirmed");
    assert.equal((await service.room(participant, post.id)).canWrite, false);
    const again = await webhook(event);
    assert.equal(again.status, 200);
    assert.equal(again.result.ok && again.result.data.duplicate, true);
    assert.equal(
      (await webhook({ ...event, eventId: `refund-${app.orderId}`, status: "refunded" })).status,
      200,
    );
    await assert.rejects(service.room(participant, post.id));
    assert.equal((await webhook({ ...event, eventId: `out-of-order-${app.orderId}` })).status, 200);
    assert.equal((await service.overview(participant, post.id)).application?.status, "refunded");
    // Production does not turn a local development flag into a login or payment bypass.
    const simulation = await fetch(`${origin}/api/participation/orders/${app.orderId}/simulate`, {
      method: "POST",
      headers: { Origin: process.env.APP_ORIGIN!, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    });
    assert.ok([401, 403].includes(simulation.status));
    const inbox = await fetch(`${origin}/api/participation/me`);
    assert.equal(inbox.status, 401);
  } finally {
    if (postId) {
      await db.execute(
        sql`delete from sliper.payment_events where order_id in(select o.id from sliper.payment_orders o join sliper.event_applications a on a.id=o.application_id where a.post_id=${postId})`,
      );
      await db.execute(
        sql`delete from sliper.payment_orders where application_id in(select id from sliper.event_applications where post_id=${postId})`,
      );
      await db.execute(sql`delete from sliper.posts where id=${postId}`);
    }
    await db.execute(sql`delete from auth.users where id in(${owner},${participant})`);
    await connection.close();
  }
});
test("two PostgreSQL connections competing for the last seat produce exactly one reservation", async () => {
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    other = createDatabase(process.env.DATABASE_URL!, 1),
    db = connection.db,
    service = participationService(db),
    second = participationService(other.db),
    owner = randomUUID(),
    left = randomUUID(),
    right = randomUUID();
  let postId: string | null = null;
  try {
    for (const [id, name] of [
      [owner, "정원등록자"],
      [left, "참가왼쪽"],
      [right, "참가오른쪽"],
    ] as const) {
      await db.execute(sql`insert into auth.users(id) values(${id})`);
      await db.insert(profiles).values({
        id,
        nickname: name,
        phoneNumber: "01012345678",
        profileCompletedAt: new Date(),
        onboardingConsentAt: new Date(),
      });
    }
    const post = await communityService(db).createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "[정원 경합 확인 전용]",
      bodyMarkdown: "테스트",
      location: "서울",
      eventDate: "토요일",
      eventFee: "무료",
      isAnonymous: true,
      imageAssetIds: [],
    });
    postId = post.id;
    await service.configure(owner, post.id, { amountKRW: 0, capacity: 1, open: true });
    const values = await Promise.allSettled([
      service.apply(left, post.id, { consent: true }, null),
      second.apply(right, post.id, { consent: true }, null),
    ]);
    assert.equal(values.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(values.filter((v) => v.status === "rejected").length, 1);
    assert.equal((await service.overview(owner, post.id)).config?.occupied, 1);
    const rows = await db.execute(
      sql`select count(*)::int as count from sliper.room_members where post_id=${post.id} and revoked_at is null`,
    );
    assert.equal(rows[0]?.count, 1);
  } finally {
    if (postId) await db.execute(sql`delete from sliper.posts where id=${postId}`);
    await db.execute(sql`delete from auth.users where id in(${owner},${left},${right})`);
    await connection.close();
    await other.close();
  }
});

test("signed external registration callbacks approve mapped members without an internal payment order", async () => {
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    db = connection.db,
    service = participationService(db),
    owner = randomUUID(),
    participant = randomUUID();
  let postId: string | null = null;
  try {
    for (const [id, name] of [
      [owner, "외부연동등록자"],
      [participant, "외부연동참가자"],
    ] as const) {
      await db.execute(sql`insert into auth.users(id) values(${id})`);
      await db.insert(profiles).values({
        id,
        nickname: name,
        phoneNumber: "01012345678",
        profileCompletedAt: new Date(),
        onboardingConsentAt: new Date(),
      });
    }
    const post = await communityService(db).createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "[외부 신청 웹훅 검증 전용]",
      bodyMarkdown: "외부 신청 테스트",
      applicationUrl: "https://example.com/external-event",
      isAnonymous: true,
      imageAssetIds: [],
    });
    postId = post.id;
    await service.configure(owner, postId, {
      amountKRW: 10000,
      capacity: 1,
      open: true,
      approvalMode: "automatic",
    });
    const [profile] = await db
      .select({ publicId: profiles.publicId })
      .from(profiles)
      .where(sql`${profiles.id}=${participant}`);
    const event = {
      eventId: `external-paid-${postId}`,
      postId,
      publicProfileId: profile!.publicId,
      externalReference: `external-order-${postId}`,
      attendeeName: "참가자",
      contact: "test-contact",
      amountKRW: 10000,
      currency: "KRW",
      status: "paid",
    };
    assert.equal(
      (await webhook(event, false, Math.floor(Date.now() / 1000), "external-webhook")).status,
      403,
    );
    const response = await webhook(event, true, Math.floor(Date.now() / 1000), "external-webhook");
    assert.equal(response.status, 200);
    assert.equal(response.result.ok && response.result.data.status, "confirmed");
    assert.equal((await service.overview(participant, postId)).application?.orderId, null);
    assert.equal((await service.room(participant, postId)).canWrite, false);
    assert.equal(
      (await webhook(event, true, Math.floor(Date.now() / 1000), "external-webhook")).status,
      200,
    );
    const refunded = await webhook(
      { ...event, eventId: `external-refund-${postId}`, status: "refunded", refundAmountKRW: 5000 },
      true,
      Math.floor(Date.now() / 1000),
      "external-webhook",
    );
    assert.equal(refunded.status, 200);
    const [receipt] = await db.execute<{ amount: number }>(
      sql`select refunded_amount_krw as amount from sliper.external_receipts where post_id=${postId}`,
    );
    assert.equal(receipt?.amount, 5000);
    await assert.rejects(service.room(participant, postId));
  } finally {
    if (postId) {
      await db.execute(sql`delete from sliper.external_webhook_events where post_id=${postId}`);
      await db.execute(sql`delete from sliper.external_receipts where post_id=${postId}`);
      await db.execute(sql`delete from sliper.posts where id=${postId}`);
    }
    await db.execute(sql`delete from auth.users where id in(${owner},${participant})`);
    await connection.close();
  }
});
