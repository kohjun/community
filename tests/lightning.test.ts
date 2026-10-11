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
    categorySlug: "party",
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
  assert.equal(post!.eventFee, "무료");
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
test("free quick meetup reuses atomic seat limits and immediate read-only room invitations", async () => {
  const { postId } = await lightning.create(owner, input());
  const details = { consent: true };
  for (const member of participants.slice(0, 2)) {
    const event = await participation.apply(member!, postId, details, null);
    assert.equal(event.application!.status, "confirmed");
    const room = await participation.room(member!, postId);
    assert.equal(room.canWrite, false);
  }
  await assert.rejects(
    participation.apply(participants[2]!, postId, details, null),
    code("CONFLICT"),
  );
  assert.equal((await db.select().from(schema.roomMembers)).length, 2);
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
  await db
    .update(schema.posts)
    .set({ applicationUrl: "https://example.invalid/apply" })
    .where(eq(schema.posts.id, postId));
  await db
    .update(schema.eventSettings)
    .set({ amountKRW: 1000 })
    .where(eq(schema.eventSettings.postId, postId));
  await assert.rejects(
    db.update(schema.posts).set({ applicationUrl: null }).where(eq(schema.posts.id, postId)),
  );
  await db
    .update(schema.eventSettings)
    .set({ amountKRW: 0 })
    .where(eq(schema.eventSettings.postId, postId));
  await db.update(schema.posts).set({ applicationUrl: null }).where(eq(schema.posts.id, postId));
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

test("external lightning URLs normalize and require matching external amounts without changing small-meetup limits", () => {
  const external = lightningInputSchema.parse({
    ...input(),
    applicationUrl: " HTTPS://EXAMPLE.INVALID/apply ",
    priceKRW: 15000,
  });
  assert.equal(external.applicationUrl, "https://example.invalid/apply");
  assert.equal(external.priceKRW, 15000);
  assert.equal(
    lightningInputSchema.parse({ ...input(), applicationUrl: "http://example.invalid/free" })
      .priceKRW,
    0,
  );
  for (const amount of [-1, 1.5, 10000001])
    assert.equal(
      lightningInputSchema.safeParse({
        ...input(),
        applicationUrl: "https://example.invalid/apply",
        priceKRW: amount,
      }).success,
      false,
    );
});

test("external free and paid lightning require verified manual approval before any announcement-room invitation", async () => {
  for (const priceKRW of [0, 15000]) {
    const { postId, externalUrl } = await lightning.create(owner, {
      ...input(),
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
  const { postId } = await lightning.create(owner, {
    ...input(),
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
test("lightning link editing preserves mode/fee coherence and blocks active-application mode changes", async () => {
  const { postId } = await lightning.create(owner, input());
  await editLink(postId, "https://example.invalid/first");
  await participation.configure(owner, postId, { amountKRW: 5000, capacity: 2, open: true });
  assert.equal((await community.getPost(postId, owner)).eventFee, "5,000원");
  await assert.rejects(editLink(postId, null), code("VALIDATION"));
  await participation.configure(owner, postId, { amountKRW: 0, capacity: 2, open: true });
  await editLink(postId, null);
  assert.equal((await participation.overview(owner, postId)).externalUrl, null);
  await editLink(postId, "https://example.invalid/second");
  await participation.claimExternal(participants[0]!, postId, {
    consent: true,
    externalReference: "EXT-EDIT",
  });
  await assert.rejects(editLink(postId, null), code("CONFLICT"));
  assert.equal(
    (await participation.overview(owner, postId)).externalUrl,
    "https://example.invalid/second",
  );
});
