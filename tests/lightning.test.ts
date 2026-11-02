import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { lightningInputSchema, venueSchema } from "../src/domain/discovery";
import { lightningService } from "../src/server/lightning-service";
import { communityService } from "../src/server/community-service";
import { participationService } from "../src/server/participation-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  lightning = lightningService(db as unknown as Database),
  participation = participationService(db as unknown as Database),
  community = communityService(db as unknown as Database);
let owner: string, participants: string[];
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
function input() {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  return {
    categorySlug: "party" as const,
    title: "빠른 번개 모임",
    description: "동네에서 함께 예능 게임을 즐기는 번개입니다.",
    location: "테스트 행사장",
    venue: { latitude: 37, longitude: 127 },
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    capacity: 2,
    priceKRW: 0,
    applicationUrl: null,
  };
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = randomUUID();
  participants = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of [owner, ...participants]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({
      id,
      nickname: id === owner ? "호스트" : "참가자",
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    });
  }
});
after(() => pg.close());
test("quick meetup validation refuses paid or forged ownership, partial coordinates and invalid duration", () => {
  for (const patch of [
    { authorId: owner },
    { priceKRW: 100 },
    { capacity: 13 },
    { categorySlug: "lab" },
    { venue: { latitude: 37 } },
    { venue: { latitude: 91, longitude: 127 } },
    { applicationUrl: "javascript:alert(1)" },
    { applicationUrl: "https://user:password@example.invalid/" },
    { applicationUrl: "https://example.invalid/has space" },
    { priceKRW: 10000001, applicationUrl: "https://example.invalid/" },
    { endsAt: input().startsAt },
  ])
    assert.equal(lightningInputSchema.safeParse({ ...input(), ...patch }).success, false);
  assert.deepEqual(venueSchema.parse({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
});
test("creating a quick meetup atomically publishes recruitment, location, free settings and activity", async () => {
  const result = await lightning.create(owner, input());
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, result.postId));
  const [settings] = await db
    .select()
    .from(schema.eventSettings)
    .where(eq(schema.eventSettings.postId, result.postId));
  assert.equal(post!.authorId, owner);
  assert.equal(post!.kind, "모집");
  assert.equal(post!.eventFee, "현장 정산");
  assert.equal(settings!.meetupType, "lightning");
  assert.equal(settings!.amountKRW, 0);
  assert.equal(settings!.capacity, 2);
  assert.equal(settings!.venueLatitude, 37);
  assert.equal(settings!.venueLongitude, 127);
  assert.equal(result.applicationUrl, `/events/${result.postId}`);
  assert.equal((await db.select().from(schema.activityEvents)).length, 1);
});
test("anonymous and past or distant creation fails without leaving a recruitment or event", async () => {
  await assert.rejects(lightning.create(null, input()), code("UNAUTHENTICATED"));
  for (const offset of [-86400000, 8 * 86400000]) {
    const startsAt = new Date(Date.now() + offset).toISOString();
    await assert.rejects(
      lightning.create(owner, {
        ...input(),
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
      }),
      code("VALIDATION"),
    );
  }
  assert.equal((await db.select().from(schema.posts)).length, 0);
  assert.equal((await db.select().from(schema.eventSettings)).length, 0);
});
test("direct lightning applications wait without payment or room access until manual approval", async () => {
  const { postId } = await lightning.create(owner, input());
  const applications = [];
  for (const member of participants) {
    const event = await participation.apply(member!, postId, { consent: true }, null);
    const app = event.application!;
    applications.push(app);
    assert.equal(app.status, "pending_approval");
    assert.equal(app.orderId, null);
    assert.equal(app.expiresAt, null);
    assert.equal(event.config!.occupied, 0);
    await assert.rejects(participation.room(member!, postId), code("FORBIDDEN"));
    assert.equal((await participation.home(member!)).rooms.length, 0);
  }
  const retried = await participation.apply(participants[0]!, postId, { consent: true }, "bridge");
  assert.equal(retried.application!.id, applications[0]!.id);
  assert.equal((await db.select().from(schema.eventApplications)).length, 3);
  const results = await Promise.allSettled(
    applications.map((app) =>
      participation.decideSiteApplication(owner, app.id, { decision: "approve" }),
    ),
  );
  assert.equal(results.filter((v) => v.status === "fulfilled").length, 2);
  assert.equal(results.filter((v) => v.status === "rejected").length, 1);
  assert.equal((await participation.overview(owner, postId)).config!.occupied, 2);
  assert.equal((await db.select().from(schema.roomMembers)).length, 2);
  assert.equal((await db.select().from(schema.paymentOrders)).length, 0);
  assert.equal((await db.select().from(schema.externalReceipts)).length, 0);
  for (const member of participants.slice(0, 2)) {
    assert.equal((await participation.room(member!, postId)).canWrite, false);
    await assert.rejects(
      participation.send(member!, postId, { body: "참가자 메시지" }),
      code("FORBIDDEN"),
    );
  }
});

test("owner settings preserve omitted location and committed locations cannot be replaced", async () => {
  const { postId } = await lightning.create(owner, input());
  const config = { amountKRW: 0, capacity: 2, open: true };
  await assert.rejects(
    participation.configure(participants[0]!, postId, config),
    code("FORBIDDEN"),
  );
  const first = await participation.configure(owner, postId, config);
  assert.deepEqual(first.config!.venue, input().venue);
  await participation.apply(participants[0]!, postId, { consent: true }, null);
  await assert.rejects(
    participation.configure(owner, postId, { ...config, venue: { latitude: 38, longitude: 127 } }),
    code("CONFLICT"),
  );
  await assert.rejects(
    participation.configure(owner, postId, { ...config, venue: null }),
    code("VALIDATION"),
  );
  await assert.rejects(
    participation.configure(owner, postId, { ...config, amountKRW: 100 }),
    code("VALIDATION"),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ meetupType: "event" })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ venueLatitude: 38 })
      .where(eq(schema.eventSettings.postId, postId)),
  );
});
test("database checks reject invalid coordinate pairs and enforce the free small-meetup contract", async () => {
  const { postId } = await lightning.create(owner, input());
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ venueLongitude: null })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ venueLatitude: 100 })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ capacity: 13 })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ amountKRW: 100 })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  const [unchanged] = await db
    .select()
    .from(schema.eventSettings)
    .where(eq(schema.eventSettings.postId, postId));
  await assert.rejects(
    db.update(schema.posts).set({ kind: "이야기" }).where(eq(schema.posts.id, postId)),
  );
  await assert.rejects(
    db
      .update(schema.posts)
      .set({ applicationUrl: "https://example.invalid/apply" })
      .where(eq(schema.posts.id, postId)),
  );
  await assert.rejects(
    db
      .update(schema.eventSettings)
      .set({ approvalMode: "automatic" })
      .where(eq(schema.eventSettings.postId, postId)),
  );
  await assert.rejects(
    db.update(schema.posts).set({ eventFee: "1000원" }).where(eq(schema.posts.id, postId)),
  );
  assert.equal(unchanged!.capacity, 2);
  assert.equal(unchanged!.venueLatitude, 37);
  assert.equal(
    (await db.execute(sql`select count(*)::int as count from sliper.event_settings`)).rows[0]
      ?.count,
    1,
  );
});

test("new lightning never accepts external prepayment links or nonzero amounts", () => {
  for (const priceKRW of [0, 15000])
    assert.equal(
      lightningInputSchema.safeParse({
        ...input(),
        applicationUrl: "https://example.invalid/apply",
        priceKRW,
      }).success,
      false,
    );
  for (const priceKRW of [-1, 1.5, 100, 10000001])
    assert.equal(lightningInputSchema.safeParse({ ...input(), priceKRW }).success, false);
});

// Old externally paid lightning remains readable and refundable; new creation is intentionally unavailable.
async function legacyExternal(options: { applicationUrl: string; priceKRW: number }) {
  const value = input();
  const [post] = await db
    .insert(schema.posts)
    .values({
      authorId: owner,
      categorySlug: value.categorySlug,
      kind: "모집",
      title: value.title,
      bodyMarkdown: value.description,
      location: value.location,
      eventFee: options.priceKRW === 0 ? "무료" : options.priceKRW.toLocaleString("ko-KR") + "원",
      applicationUrl: options.applicationUrl,
    })
    .returning({ id: schema.posts.id });
  await db.insert(schema.eventSettings).values({
    postId: post!.id,
    meetupType: "lightning",
    venueLatitude: value.venue.latitude,
    venueLongitude: value.venue.longitude,
    startsAt: new Date(value.startsAt),
    endsAt: new Date(value.endsAt),
    capacity: value.capacity,
    amountKRW: options.priceKRW,
    approvalMode: "manual",
    open: true,
  });
  return { postId: post!.id, externalUrl: options.applicationUrl };
}

test("external free and paid lightning require verified manual approval before any announcement-room invitation", async () => {
  for (const priceKRW of [0, 15000]) {
    const { postId, externalUrl } = await legacyExternal({
      applicationUrl: "https://example.invalid/apply",
      priceKRW,
    });
    const overview = await participation.overview(participants[0]!, postId);
    assert.equal(externalUrl, "https://example.invalid/apply");
    assert.equal(overview.config?.amountKRW, priceKRW);
    assert.equal(overview.application, null);
    await assert.rejects(
      participation.apply(participants[0]!, postId, { consent: true }, null),
      code("CONFLICT"),
    );
    assert.equal((await db.select().from(schema.paymentOrders)).length, 0);
    const claimed = await participation.claimExternal(participants[0]!, postId, {
      consent: true,
      refundConsent: true,
      externalReference: "EXT-" + priceKRW,
    });
    assert.equal(claimed.application!.status, "pending_approval");
    assert.equal(claimed.application!.amountKRW, priceKRW);
    await assert.rejects(participation.room(participants[0]!, postId), code("FORBIDDEN"));
    await assert.rejects(
      participation.decideExternal(participants[1]!, claimed.application!.id, {
        decision: "approve",
        paymentChecked: true,
      }),
      code("FORBIDDEN"),
    );
    await participation.decideExternal(owner, claimed.application!.id, {
      decision: "approve",
      paymentChecked: true,
    });
    assert.equal(
      (await participation.overview(participants[0]!, postId)).application!.status,
      "confirmed",
    );
    assert.equal((await participation.room(participants[0]!, postId)).canWrite, false);
  }
  assert.equal((await db.select().from(schema.roomMembers)).length, 2);
});

test("external lightning auto-approval requires an actual matching verified receipt, not a click or confirmation claim", async () => {
  const { postId } = await legacyExternal({
    applicationUrl: "https://example.invalid/pay",
    priceKRW: 8000,
  });
  await participation.configure(owner, postId, {
    amountKRW: 8000,
    capacity: 2,
    open: true,
    approvalMode: "automatic",
  });
  const pending = await participation.claimExternal(participants[0]!, postId, {
    consent: true,
    refundConsent: true,
    externalReference: "EXT-AUTO",
  });
  assert.equal(pending.application!.status, "pending_approval");
  const [member] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, participants[0]!));
  const payment = {
    eventId: "test-lightning-paid",
    postId,
    publicProfileId: member!.publicId,
    externalReference: "EXT-AUTO",
    attendeeName: "참가자",
    contact: "01012345678",
    amountKRW: 8000,
    currency: "KRW",
    status: "paid",
  };
  await assert.rejects(
    participation.externalPayment("test-provider", { ...payment, amountKRW: 7000 }),
    code("CONFLICT"),
  );
  assert.equal((await db.select().from(schema.roomMembers)).length, 0);
  const verified = await participation.externalPayment("test-provider", payment);
  assert.equal(verified.status, "confirmed");
  assert.equal((await participation.room(participants[0]!, postId)).canWrite, false);
  assert.equal((await db.select().from(schema.paymentOrders)).length, 0);
});

async function editLink(postId: string, applicationUrl: string | null) {
  const current = await community.getPost(postId, owner);
  return community.updatePost(owner, {
    postId,
    expectedUpdatedAt: current.updatedAt,
    categorySlug: current.category,
    kind: "모집",
    title: current.title,
    bodyMarkdown: current.body,
    location: current.location,
    eventDate: current.eventDate,
    eventFee: current.eventFee,
    applicationUrl,
  });
}
test("direct lightning cannot switch to paid, external or automatic approval through editing", async () => {
  const { postId } = await lightning.create(owner, input());
  await assert.rejects(editLink(postId, "https://example.invalid/first"), code("VALIDATION"));
  await assert.rejects(
    participation.configure(owner, postId, { amountKRW: 5000, capacity: 2, open: true }),
    code("VALIDATION"),
  );
  await assert.rejects(
    participation.configure(owner, postId, {
      amountKRW: 0,
      capacity: 2,
      open: true,
      approvalMode: "automatic",
    }),
    code("VALIDATION"),
  );
  const event = await participation.configure(owner, postId, {
    amountKRW: 0,
    capacity: 2,
    open: true,
  });
  assert.equal(event.externalUrl, null);
  assert.equal(event.config!.approvalMode, "manual");
  assert.equal((await community.getPost(postId, owner)).eventFee, "현장 정산");
  await editLink(postId, null);
  const legacy = await legacyExternal({
    applicationUrl: "https://example.invalid/legacy",
    priceKRW: 5000,
  });
  await editLink(legacy.postId, "https://example.invalid/legacy-updated");
  assert.equal(
    (await participation.overview(owner, legacy.postId)).externalUrl,
    "https://example.invalid/legacy-updated",
  );
});

test("only an owner or appointed manager can decide; repeat decisions do not rewrite confirmation or membership", async () => {
  const { postId } = await lightning.create(owner, input());
  const app = (await participation.apply(participants[0]!, postId, { consent: true }, null))
    .application!;
  await assert.rejects(
    participation.decideSiteApplication(null, app.id, { decision: "approve" }),
    code("UNAUTHENTICATED"),
  );
  await assert.rejects(
    participation.decideSiteApplication(participants[0]!, app.id, { decision: "approve" }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    participation.decideSiteApplication(participants[1]!, app.id, { decision: "approve" }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    participation.decideSiteApplication(owner, app.id, {
      decision: "approve",
      paymentChecked: true,
    }),
  );
  const [manager] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, participants[1]!));
  await participation.setManager(owner, postId, { publicId: manager!.publicId, enabled: true });
  await participation.decideSiteApplication(participants[1]!, app.id, {
    decision: "approve",
    reason: "참가 확인",
  });
  const [confirmed] = await db
    .select()
    .from(schema.eventApplications)
    .where(eq(schema.eventApplications.id, app.id));
  await participation.decideSiteApplication(owner, app.id, {
    decision: "approve",
    reason: "재시도",
  });
  const [retried] = await db
    .select()
    .from(schema.eventApplications)
    .where(eq(schema.eventApplications.id, app.id));
  assert.equal(confirmed!.confirmedAt!.getTime(), retried!.confirmedAt!.getTime());
  assert.equal(retried!.decisionNote, "참가 확인");
  assert.equal((await db.select().from(schema.roomMembers)).length, 1);
  assert.equal((await participation.home(participants[0]!)).rooms.length, 1);
  const messages = await participation.send(owner, postId, {
    body: "승인된 참가자에게 보내는 공지입니다.",
  });
  assert.equal(messages.messages.length, 1);
  assert.equal((await participation.room(participants[0]!, postId)).messages.length, 1);
});

test("rejection and cancellation revoke access; reapplication creates a fresh pending request without an order", async () => {
  const { postId } = await lightning.create(owner, input());
  const user = participants[0]!;
  const first = (await participation.apply(user, postId, { consent: true }, null)).application!;
  await assert.rejects(
    participation.decideSiteApplication(owner, first.id, { decision: "reject" }),
  );
  await participation.decideSiteApplication(owner, first.id, {
    decision: "reject",
    reason: "이번 모임의 참가 조건을 확인해주세요.",
  });
  await participation.decideSiteApplication(owner, first.id, {
    decision: "reject",
    reason: "재시도",
  });
  assert.equal((await participation.overview(user, postId)).application!.status, "rejected");
  await assert.rejects(participation.room(user, postId), code("FORBIDDEN"));
  const second = (await participation.apply(user, postId, { consent: true }, null)).application!;
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "pending_approval");
  await participation.cancel(user, second.id);
  await assert.rejects(
    participation.decideSiteApplication(owner, second.id, { decision: "approve" }),
    code("CONFLICT"),
  );
  const third = (await participation.apply(user, postId, { consent: true }, null)).application!;
  await participation.decideSiteApplication(owner, third.id, { decision: "approve" });
  assert.equal((await participation.room(user, postId)).canWrite, false);
  await participation.cancel(user, third.id);
  await participation.cancel(user, third.id);
  await assert.rejects(participation.room(user, postId), code("FORBIDDEN"));
  assert.equal((await participation.home(user)).rooms.length, 0);
  const fourth = (await participation.apply(user, postId, { consent: true }, null)).application!;
  assert.equal(fourth.status, "pending_approval");
  assert.equal(fourth.expiresAt, null);
  assert.equal((await db.select().from(schema.paymentOrders)).length, 0);
});

test("the database refuses bypassing initial manual approval or creating a payment reservation for direct lightning", async () => {
  const { postId } = await lightning.create(owner, input());
  const candidate = {
    postId,
    userId: participants[0]!,
    attendeeName: "참가자",
    contact: "01012345678",
    amountKRW: 0,
  };
  for (const state of [
    { status: "confirmed", confirmedAt: new Date() },
    { status: "pending_payment", expiresAt: new Date(Date.now() + 1800000) },
    { status: "pending_approval", expiresAt: new Date(Date.now() + 1800000) },
    { status: "pending_approval", confirmedAt: new Date() },
  ])
    await assert.rejects(db.insert(schema.eventApplications).values({ ...candidate, ...state }));
  assert.equal((await db.select().from(schema.eventApplications)).length, 0);
});

test("manual site decisions never approve ordinary events or historical external payment claims", async () => {
  const external = await legacyExternal({
    applicationUrl: "https://example.invalid/legacy",
    priceKRW: 1000,
  });
  const app = (
    await participation.claimExternal(participants[0]!, external.postId, {
      consent: true,
      refundConsent: true,
      externalReference: "LEGACY-REQUEST",
    })
  ).application!;
  await assert.rejects(
    participation.decideSiteApplication(owner, app.id, { decision: "approve" }),
    code("CONFLICT"),
  );
  assert.equal(
    (await participation.overview(participants[0]!, external.postId)).application!.status,
    "pending_approval",
  );
  assert.equal((await db.select().from(schema.externalReceipts)).length, 0);
  const normal = await community.createPost(owner, {
    categorySlug: "party",
    kind: "모집",
    title: "일반 무료 행사",
    bodyMarkdown: "일반 행사의 기존 신청 방식을 유지합니다.",
    location: "서울",
    eventDate: "주말",
    eventFee: "무료",
  });
  await participation.configure(owner, normal.id, { amountKRW: 0, capacity: 2, open: true });
  const confirmed = (
    await participation.apply(participants[0]!, normal.id, { consent: true }, null)
  ).application!;
  assert.equal(confirmed.status, "confirmed");
  await assert.rejects(
    participation.decideSiteApplication(owner, confirmed.id, {
      decision: "reject",
      reason: "다른 신청 경로",
    }),
    code("CONFLICT"),
  );
  assert.equal((await participation.room(participants[0]!, normal.id)).canWrite, false);
});

test("participant guidance persists with approval flow; owner-only, versioned and omitted updates preserve it", async () => {
  const guide = {
    version: 1 as const,
    experience: "beginner" as const,
    company: "solo" as const,
    atmosphere: "relaxed" as const,
    intensity: "light" as const,
    onsiteMinKRW: 5000,
    onsiteMaxKRW: 10000,
    costNote: "음료는 각자 주문해요.",
    arrival: "입구에서 담당자와 만나 규칙을 안내받아요.",
    preparations: "편한 신발",
  };
  const created = await lightning.create(owner, { ...input(), participantGuide: guide });
  const initial = await participation.overview(owner, created.postId);
  assert.deepEqual(initial.config?.participantGuide, guide);
  assert.match(initial.config?.guideVersion ?? "", /^g1-/);
  const settings = { amountKRW: 0, capacity: 2, open: true, approvalMode: "manual" as const };
  await assert.rejects(
    participation.configure(participants[0]!, created.postId, {
      ...settings,
      participantGuide: guide,
      guideVersion: initial.config!.guideVersion,
    }),
    code("FORBIDDEN"),
  );
  await participation.configure(owner, created.postId, {
    ...settings,
    participantGuide: { ...guide, arrival: "정문으로 모여 함께 입장해요." },
    guideVersion: initial.config!.guideVersion,
  });
  await assert.rejects(
    participation.configure(owner, created.postId, {
      ...settings,
      participantGuide: guide,
      guideVersion: initial.config!.guideVersion,
    }),
    code("CONFLICT"),
  );
  await participation.configure(owner, created.postId, settings);
  const updated = await participation.overview(owner, created.postId);
  assert.equal(updated.config?.participantGuide?.arrival, "정문으로 모여 함께 입장해요.");
  await assert.rejects(
    participation.configure(owner, created.postId, {
      ...settings,
      participantGuide: { ...guide, arrival: "씨발" },
      guideVersion: updated.config!.guideVersion,
    }),
    code("VALIDATION"),
  );
  await participation.configure(owner, created.postId, {
    ...settings,
    participantGuide: null,
    guideVersion: updated.config!.guideVersion,
  });
  assert.equal(
    (await participation.overview(owner, created.postId)).config?.participantGuide,
    null,
  );
});
test("guidance rejects malformed or ambiguous costs and does not make old events beginner friendly", async () => {
  const { emptyParticipantGuide, participantGuideSchema, onsiteCostLabel } =
    await import("../src/domain/participant-guide");
  const guide = emptyParticipantGuide();
  assert.equal(onsiteCostLabel(null), "예상 금액 미안내");
  for (const patch of [
    { onsiteMinKRW: 5000 },
    { onsiteMaxKRW: 5000 },
    { onsiteMinKRW: 2000, onsiteMaxKRW: 1000 },
    { onsiteMinKRW: -1, onsiteMaxKRW: 0 },
    { experience: "verified" },
    { arrival: "가".repeat(601) },
    { onsiteMinKRW: 0.5, onsiteMaxKRW: 1 },
  ])
    assert.equal(participantGuideSchema.safeParse({ ...guide, ...patch }).success, false);
  assert.equal(
    onsiteCostLabel({ ...guide, onsiteMinKRW: 0, onsiteMaxKRW: 0 }),
    "예상 현장 비용 없음",
  );
  const created = await lightning.create(owner, input());
  assert.equal(
    (await participation.overview(owner, created.postId)).config?.participantGuide,
    null,
  );
});
