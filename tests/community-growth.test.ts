import assert from "node:assert/strict";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import * as growth from "../src/db/growth-schema";
import { eventResults } from "../src/db/player-schema";
import { contentRestrictions, memberBlocks } from "../src/db/safety-schema";
import { inboxItems, categorySubscriptions } from "../src/db/engagement-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { emptyParticipantGuide } from "../src/domain/participant-guide";
import { savedSearchService } from "../src/server/saved-search-service";
import { waitlistService, advanceWaitlist } from "../src/server/waitlist-service";
import { communityGrowthService } from "../src/server/community-growth-service";
import { participationService } from "../src/server/participation-service";
import { engagementService } from "../src/server/engagement-service";
import { assertReunionImageAccess } from "../src/server/reunion-media-access";
import { lightningService } from "../src/server/lightning-service";
import { mediaRetentionService } from "../src/server/media-retention-service";
import { pushSubscriptions } from "../src/db/push-schema";
import { pushDispatcher } from "../src/server/push-dispatcher";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  database = db as unknown as Database;
const saved = savedSearchService(database),
  queue = waitlistService(database),
  service = communityGrowthService(database),
  participation = participationService(database);
let owner: string, a: string, b: string, c: string;
const code = (v: string) => (e: unknown) => e instanceof AppError && e.code === v;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  [owner, a, b, c] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const id of [owner, a, b, c]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({
      id,
      nickname: "테스트회원",
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    });
  }
});
after(() => pg.close());
async function event(capacity = 1) {
  const [p] = await db
    .insert(schema.posts)
    .values({
      authorId: owner,
      categorySlug: "mind-games",
      kind: "모집",
      title: "서울 추리게임 모임",
      bodyMarkdown: "함께 추리 게임을 해보는 모임입니다.",
      location: "서울 강남",
      isAnonymous: false,
    })
    .returning();
  await db.insert(schema.eventSettings).values({
    postId: p!.id,
    amountKRW: 0,
    capacity,
    startsAt: new Date(Date.now() + 86400000),
    endsAt: new Date(Date.now() + 90000000),
    participantGuide: { ...emptyParticipantGuide(), experience: "beginner", company: "solo" },
  });
  return p!.id;
}
const application = { consent: true, note: "", answers: [], refundConsent: false };
async function forceScan() {
  await db.update(growth.savedSearches).set({ nextScanAt: new Date(0) });
  return saved.scan();
}
async function advance(id: string) {
  await database.transaction(async (tx) => {
    await tx.select().from(schema.posts).where(eq(schema.posts.id, id)).for("update");
    await advanceWaitlist(tx, id);
  });
}
async function completed() {
  const id = await event(3);
  await db
    .update(schema.eventSettings)
    .set({ startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000) })
    .where(eq(schema.eventSettings.postId, id));
  const [app] = await db
    .insert(schema.eventApplications)
    .values({
      postId: id,
      userId: a,
      attendeeName: "참가자",
      contact: "01012345678",
      amountKRW: 0,
      status: "confirmed",
      expiresAt: new Date(Date.now() + 3600000),
      confirmedAt: new Date(),
    })
    .returning();
  await db.insert(eventResults).values({
    applicationId: app!.id,
    postId: id,
    userId: a,
    recorderId: owner,
    presence: "attended",
  });
  await db
    .update(schema.eventSettings)
    .set({ completedAt: new Date(), completedBy: owner, open: false })
    .where(eq(schema.eventSettings.postId, id));
  return id;
}
test("saved search owns settings, matches literal region/category/beginner and deduplicates alerts", async () => {
  const [s] = await saved.save(a, {
    name: "내 추리",
    region: "서울",
    category: "mind-games",
    beginnerOnly: true,
    soloOnly: true,
    frequency: "instant",
  });
  const id = await event();
  assert.equal(await forceScan(), 1);
  assert.equal(await forceScan(), 0);
  assert.equal((await saved.matches(a, s!.id)).items[0]!.id, id);
  await assert.rejects(
    () => saved.remove(b, s!.id).then(async () => saved.matches(b, s!.id)),
    code("NOT_FOUND"),
  );
  assert.equal((await saved.list(a)).length, 1);
  assert.equal(
    (await engagementService(database).inbox(a)).items.filter((i) => i.kind === "subscriptions")
      .length,
    1,
  );
  await db
    .insert(categorySubscriptions)
    .values({ userId: a, categorySlug: "mind-games", createdAt: new Date(0) });
  const { id: _, createdAt: __, ...settings } = s!;
  await saved.save(a, { ...settings, frequency: "off" }, s!.id);
  assert.equal(
    (await engagementService(database).inbox(a)).items.filter((i) => i.kind === "subscriptions")
      .length,
    0,
  );
});
test("daily matching stays capped and never exposes blocked/hidden events", async () => {
  await saved.save(a, { name: "매일", frequency: "daily" });
  await event();
  const second = await event();
  assert.equal(await forceScan(), 1);
  assert.equal(await forceScan(), 0);
  await db.update(growth.savedSearches).set({ lastDeliveredAt: new Date(0) });
  await db.insert(memberBlocks).values({ blockerId: a, blockedId: owner, displayLabel: "주최자" });
  assert.equal(await forceScan(), 0);
  await db.delete(memberBlocks);
  await db.insert(contentRestrictions).values({
    targetType: "post",
    targetId: second,
    hidden: true,
    reason: "테스트",
    updatedBy: owner,
  });
  assert.equal(await forceScan(), 0);
});
test("waitlist reserves a released seat for the first member and consumes only on application", async () => {
  const id = await event();
  const first = await participation.apply(a, id, application, null);
  assert.equal((await queue.update(b, id, { join: true })).state, "waiting");
  await db
    .update(growth.eventWaitlist)
    .set({ createdAt: sql`date_trunc('milliseconds',created_at)+interval '123 microseconds'` })
    .where(eq(growth.eventWaitlist.userId, b));
  assert.equal((await queue.view(b, id)).position, 1);
  assert.equal((await queue.update(c, id, { join: true })).position, 2);
  await participation.cancel(a, first.application!.id);
  await advance(id);
  assert.equal((await queue.view(b, id)).state, "offered");
  await assert.rejects(() => participation.apply(c, id, application, null), code("CONFLICT"));
  await participation.apply(b, id, application, null);
  assert.equal((await queue.view(b, id)).state, "submitted");
  assert.equal((await queue.view(c, id)).state, "waiting");
  const rows = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.recipientId, b), sql`dedupe_key like 'waitlist:%'`));
  assert.equal(rows.length, 1);
});
test("expired offer moves to next member; external and available events reject waitlist", async () => {
  const id = await event();
  await assert.rejects(() => queue.update(a, id, { join: true }), code("CONFLICT"));
  const first = await participation.apply(a, id, application, null);
  await queue.update(b, id, { join: true });
  await queue.update(c, id, { join: true });
  await participation.cancel(a, first.application!.id);
  await advance(id);
  await db
    .update(growth.eventWaitlist)
    .set({ offerUntil: new Date(0) })
    .where(eq(growth.eventWaitlist.userId, b));
  await advance(id);
  assert.equal((await queue.view(b, id)).state, "expired");
  assert.equal((await queue.view(c, id)).state, "offered");
  await db
    .update(schema.posts)
    .set({ applicationUrl: "https://example.invalid/event" })
    .where(eq(schema.posts.id, id));
  await advance(id);
  assert.equal((await queue.view(c, id)).state, "cancelled");
});
test("proposals have idempotent interests and only an actual event owner may link recruitment", async () => {
  const proposal = await service.createIdea(a, {
    title: "초보 모임 열어주세요",
    body: "처음 참가해도 함께할 추리 모임을 원해요.",
    category: "mind-games",
    region: "서울",
    dateFrom: "2099-01-01",
    dateTo: "2099-01-02",
  });
  await service.interest(b, proposal.id, { interested: true });
  await service.interest(b, proposal.id, { interested: true });
  assert.equal((await service.ideas(a)).items[0]!.count, 1);
  const id = await event();
  await assert.rejects(
    () => service.linkEvent(b, proposal.id, { eventId: id, linked: true }),
    code("FORBIDDEN"),
  );
  await service.linkEvent(owner, proposal.id, { eventId: id, linked: true });
  assert.equal((await service.ideas(a)).items[0]!.events[0]!.id, id);
  await service.closeIdea(a, proposal.id, { closed: true });
  await assert.rejects(
    () => service.interest(c, proposal.id, { interested: true }),
    code("CONFLICT"),
  );
});
test("post-event sharing enforces attendance, chosen audience, stale edits and private photo URLs", async () => {
  const id = await completed(),
    photo = randomUUID();
  await db.insert(schema.mediaAssets).values({
    id: photo,
    uploaderId: a,
    objectKey: photo + ".webp",
    contentType: "image/webp",
    byteSize: 100,
    status: "ready",
  });
  await assert.rejects(
    () =>
      service.saveReflection(b, id, {
        body: "참가하지 않았어요",
        visibility: "members",
        version: 0,
      }),
    code("FORBIDDEN"),
  );
  await service.saveReflection(a, id, {
    body: "함께 추리해서 즐거웠어요",
    nextWish: "다음에는 레이스",
    visibility: "participants",
    version: 0,
    photos: [photo],
  });
  assert.equal((await service.reunionView(b, id)).notes.length, 0);
  await assert.rejects(() => assertReunionImageAccess(database, id, photo, b), code("NOT_FOUND"));
  await assertReunionImageAccess(database, id, photo, owner);
  await assert.rejects(
    () => service.saveReflection(a, id, { body: "덮어쓰기", visibility: "members", version: 0 }),
    code("CONFLICT"),
  );
  await service.saveReflection(a, id, {
    body: "함께 추리해서 즐거웠어요",
    visibility: "members",
    version: 1,
    photos: [photo],
  });
  assert.equal((await service.reunionView(b, id)).notes.length, 1);
  await assertReunionImageAccess(database, id, photo, b);
  await assert.rejects(() =>
    db.update(schema.mediaAssets).set({ postId: id }).where(eq(schema.mediaAssets.id, photo)),
  );
  await assert.rejects(() =>
    db
      .update(schema.mediaAssets)
      .set({ reunionOriginPostId: null })
      .where(eq(schema.mediaAssets.id, photo)),
  );
  await service.deleteReflection(a, id);
  await assert.rejects(() => assertReunionImageAccess(database, id, photo, b), code("NOT_FOUND"));
});

test("lightning offer requires organizer approval and preserves its reserved place", async () => {
  const start = new Date(Date.now() + 86400000);
  const created = await lightningService(database).create(owner, {
    categorySlug: "party",
    title: "승인 대기 테스트 모임",
    description: "담당자 승인 후 함께하는 번개 모임입니다.",
    location: "서울",
    venue: { latitude: 37, longitude: 127 },
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3600000).toISOString(),
    capacity: 2,
    priceKRW: 0,
    applicationUrl: null,
  });
  const id = created.postId;
  const aa = await participation.apply(a, id, application, null),
    bb = await participation.apply(b, id, application, null);
  await participation.decideSiteApplication(owner, aa.application!.id, {
    decision: "approve",
    reason: "",
  });
  await participation.decideSiteApplication(owner, bb.application!.id, {
    decision: "approve",
    reason: "",
  });
  await queue.update(c, id, { join: true });
  await participation.cancel(a, aa.application!.id);
  await advance(id);
  const cc = await participation.apply(c, id, application, null);
  assert.equal(cc.application!.status, "pending_approval");
  await assert.rejects(() => participation.room(c, id));
  const again = await participation.apply(a, id, application, null).catch(() => null);
  assert.equal(again, null);
  await participation.decideSiteApplication(owner, cc.application!.id, {
    decision: "approve",
    reason: "",
  });
  assert.equal((await participation.overview(c, id)).application!.status, "confirmed");
  await participation.room(c, id);
});
test("reunion photos remain excluded from unattached cleanup and block future public attachment", async () => {
  const id = await completed(),
    photo = randomUUID();
  await db.insert(schema.mediaAssets).values({
    id: photo,
    uploaderId: a,
    objectKey: photo + ".webp",
    contentType: "image/webp",
    byteSize: 100,
    status: "ready",
    unattachedSince: new Date(Date.now() - 40 * 86400000),
  });
  await service.saveReflection(a, id, {
    body: "행사 사진이에요",
    visibility: "participants",
    version: 0,
    photos: [photo],
  });
  assert.equal((await mediaRetentionService(database).summary()).eligibleImages, 0);
  await db.insert(memberBlocks).values({ blockerId: owner, blockedId: a, displayLabel: "참가자" });
  await assert.rejects(
    () => assertReunionImageAccess(database, id, photo, owner),
    code("NOT_FOUND"),
  );
  await assert.rejects(
    () => assertReunionImageAccess(database, id, photo, null),
    code("UNAUTHENTICATED"),
  );
});
test("saved conditions and queue mutations never trust client ownership or unknown fields", async () => {
  await assert.rejects(() => saved.save(a, { name: "위조", userId: b }));
  await assert.rejects(() => saved.list(null), code("UNAUTHENTICATED"));
  const id = await event();
  await assert.rejects(() => queue.update(a, id, { join: true, userId: b }));
  await assert.rejects(
    () =>
      service.createIdea(a, {
        title: "과거 모임",
        body: "과거 날짜에는 새 모임을 열지 않아요.",
        category: "party",
        region: "서울",
        dateFrom: "2020-01-01",
        dateTo: "2020-01-02",
      }),
    code("VALIDATION"),
  );
});

async function pushFixture(userId: string) {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  const config = {
    subject: "mailto:fixture@example.invalid",
    publicKey: curve.getPublicKey().toString("base64url"),
    privateKey: curve.getPrivateKey().toString("base64url"),
  };
  const client = createECDH("prime256v1");
  client.generateKeys();
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: "https://web.push.apple.com/fixture/" + randomUUID(),
    p256dh: client.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    vapidPublicKey: config.publicKey,
  });
  return config;
}
test("saved-search push reaches the local saved-results destination without a real provider call", async () => {
  const config = await pushFixture(b);
  await saved.save(b, { name: "하루 한 번 모임", frequency: "daily" });
  await event();
  await forceScan();
  const sent: string[] = [];
  await pushDispatcher(database, config, async (_s, d) => {
    sent.push(d.url);
  }).drain();
  assert.deepEqual(sent, ["/discover/saved"]);
});
test("waitlist push validates its offered source and suppresses an expired opportunity", async () => {
  const config = await pushFixture(b),
    id = await event();
  const first = await participation.apply(a, id, application, null);
  await queue.update(b, id, { join: true });
  await participation.cancel(a, first.application!.id);
  await advance(id);
  const sent: string[] = [];
  const dispatcher = pushDispatcher(database, config, async (_s, d) => {
    sent.push(d.url);
  });
  await dispatcher.drain();
  assert.deepEqual(sent, ["/events/" + id]);
  const secondId = await event();
  const second = await participation.apply(a, secondId, application, null);
  await queue.update(b, secondId, { join: true });
  await participation.cancel(a, second.application!.id);
  await advance(secondId);
  await db
    .update(growth.eventWaitlist)
    .set({ offerUntil: new Date(0) })
    .where(eq(growth.eventWaitlist.postId, secondId));
  await dispatcher.drain();
  assert.equal(sent.length, 1);
});
