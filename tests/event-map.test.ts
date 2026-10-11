import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as baseSchema from "../src/db/schema";
import * as venueSchema from "../src/db/venue-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { eventMapQuerySchema, venueInputSchema } from "../src/domain/event-map";
import { eventMapService } from "../src/server/event-map-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...baseSchema, ...venueSchema } });
const service = eventMapService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
let owner: string, other: string, ownerPublicId: string;
const input = () => ({
  name: "같이 노는 공원",
  address: "서울특별시 마포구 공원로 10",
  description: "야외 미션과 소규모 게임을 진행하기 좋은 넓은 공원입니다.",
  latitude: 37.55,
  longitude: 126.92,
  categorySlug: "party" as const,
  spaceType: "outdoor" as const,
  isFree: true,
  feeNote: "",
  capacity: 20,
  tags: ["야외", "미션"],
  websiteUrl: "https://example.com/park",
});
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  const [profile] = await db
    .insert(baseSchema.profiles)
    .values({ id, nickname, phoneNumber: "01012345678" })
    .returning();
  return profile!;
}
async function event(
  patch: {
    category?: "party" | "sports";
    sample?: boolean;
    deleted?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    open?: boolean;
    amountKRW?: number;
    capacity?: number;
    meetupType?: "event" | "lightning";
    title?: string;
  } = {},
) {
  const [post] = await db
    .insert(baseSchema.posts)
    .values({
      authorId: owner,
      categorySlug: patch.category ?? "party",
      kind: "모집",
      sample: patch.sample ?? false,
      title: patch.title ?? "실제로 열리는 예능 모임",
      bodyMarkdown: "참가자 연락처와 내부 진행자 정보는 비공개입니다.",
      location: "공개 행사장",
      contactInfo: "01012345678",
      applicationUrl: "https://example.com/pay",
    })
    .returning();
  await db.insert(baseSchema.eventSettings).values({
    postId: post!.id,
    venueLatitude: patch.latitude === undefined ? 37.56 : patch.latitude,
    venueLongitude: patch.longitude === undefined ? 126.93 : patch.longitude,
    startsAt: patch.startsAt === undefined ? new Date(Date.now() + 3600000) : patch.startsAt,
    endsAt: patch.endsAt ?? null,
    open: patch.open ?? true,
    amountKRW: patch.amountKRW ?? 0,
    capacity: patch.capacity ?? (patch.meetupType === "lightning" ? 8 : 20),
    meetupType: patch.meetupType ?? "event",
  });
  if (patch.deleted)
    await db
      .update(baseSchema.posts)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(baseSchema.posts.id, post!.id));
  return post!.id;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(baseSchema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.community_venues cascade");
  const profile = await member("장소 알려주는 회원");
  owner = profile.id;
  ownerPublicId = profile.publicId;
  other = (await member("다른 회원")).id;
});
after(() => pg.close());

test("venue input refuses forged ownership, partial or invalid coordinates and unsafe links", () => {
  for (const patch of [
    { ownerId: owner },
    { recommendations: 200 },
    { version: 5 },
    { latitude: "37.55" },
    { longitude: undefined },
    { latitude: 91 },
    { longitude: Number.NaN },
    { categorySlug: "lab" },
    { address: "" },
    { description: "짧음" },
    { spaceType: "secret" },
    { capacity: 0 },
    { tags: ["같은 태그", "같은 태그"] },
    { websiteUrl: "javascript:alert(1)" },
    { websiteUrl: "https://username:password@example.com" },
  ])
    assert.equal(venueInputSchema.safeParse({ ...input(), ...patch }).success, false);
  assert.equal(
    venueInputSchema.safeParse({ ...input(), latitude: 0, longitude: 0, capacity: null }).success,
    true,
  );
});
test("map queries require complete increasing bounds and strict bounded filters", () => {
  for (const patch of [
    { south: 37 },
    { south: null, west: 126, north: 38, east: 128 },
    { south: false, west: 126, north: 38, east: 128 },
    { south: "", west: 126, north: 38, east: 128 },
    { south: 38, west: 126, north: 37, east: 128 },
    { south: 37, west: 128, north: 38, east: 126 },
    { south: -91, west: 126, north: 38, east: 128 },
    { q: "x".repeat(101) },
    { freeOnly: "false" },
    { mode: "mine" },
    { category: "crew" },
    { limit: 100000 },
  ])
    assert.equal(eventMapQuerySchema.safeParse(patch).success, false);
  assert.deepEqual(eventMapQuerySchema.parse({ south: "0", west: "0", north: "1", east: "1" }), {
    south: 0,
    west: 0,
    north: 1,
    east: 1,
    q: "",
    category: "all",
    mode: "all",
    freeOnly: false,
  });
});
test("public place projections expose only public contributor identity and no account or contact fields", async () => {
  await assert.rejects(service.create(null, input()), code("UNAUTHENTICATED"));
  const own = await service.create(owner, input());
  assert.equal(own.isOwner, true);
  assert.equal(own.version, 1);
  assert.deepEqual(own.contributor, {
    nickname: "장소 알려주는 회원",
    publicId: ownerPublicId,
    avatar: "spark",
  });
  const publicView = await service.detail(null, own.id.toUpperCase());
  assert.equal(publicView.isOwner, false);
  assert.equal(publicView.recommended, false);
  const serialized = JSON.stringify(publicView);
  for (const value of [owner, "01012345678", "ownerId", "phoneNumber", "status", "deletedAt"])
    assert.equal(serialized.includes(value), false);
  assert.equal((await service.list(null)).venues[0]!.id, own.id);
});
test("owners update with revision checks while other members cannot replace ownership or delete", async () => {
  const place = await service.create(owner, input());
  await assert.rejects(
    service.update(null, place.id, { ...input(), version: 1 }),
    code("UNAUTHENTICATED"),
  );
  await assert.rejects(
    service.update(other, place.id, { ...input(), version: 1 }),
    code("FORBIDDEN"),
  );
  await assert.rejects(service.remove(other, place.id, { version: 1 }), code("FORBIDDEN"));
  const updated = await service.update(owner, place.id, {
    ...input(),
    name: "수정된 게임 공원",
    version: 1,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "수정된 게임 공원");
  await assert.rejects(
    service.update(owner, place.id, { ...input(), version: 1 }),
    code("CONFLICT"),
  );
  await assert.rejects(service.remove(owner, place.id, { version: 1 }), code("CONFLICT"));
  assert.equal((await service.detail(owner, place.id)).name, "수정된 게임 공원");
});
test("explicit recommendation states are idempotent, private, and isolated per member", async () => {
  const place = await service.create(owner, input());
  await assert.rejects(service.recommend(null, place.id, { liked: true }), code("UNAUTHENTICATED"));
  for (let i = 0; i < 3; i++) {
    const result = await service.recommend(other, place.id, { liked: true });
    assert.equal(result.recommendations, 1);
    assert.equal(result.recommended, true);
    assert.equal(result.version, 1);
  }
  assert.equal((await service.detail(null, place.id)).recommended, false);
  assert.equal((await service.detail(owner, place.id)).recommended, false);
  await service.recommend(owner, place.id, { liked: true });
  await service.recommend(other, place.id, { liked: false });
  const own = await service.recommend(other, place.id, { liked: false });
  assert.equal(own.recommendations, 1);
  assert.equal(own.recommended, false);
  assert.equal((await db.select().from(venueSchema.venueRecommendations)).length, 1);
});
test("soft deletion hides places from public maps and blocks all later mutations", async () => {
  const place = await service.create(owner, input());
  await service.recommend(other, place.id, { liked: true });
  assert.deepEqual(await service.remove(owner, place.id, { version: 1 }), { id: place.id });
  assert.equal((await service.list(owner)).totalVenues, 0);
  await assert.rejects(service.detail(owner, place.id), code("NOT_FOUND"));
  await assert.rejects(service.recommend(other, place.id, { liked: true }), code("NOT_FOUND"));
  await assert.rejects(
    service.update(owner, place.id, { ...input(), version: 2 }),
    code("NOT_FOUND"),
  );
  const [stored] = await db
    .select()
    .from(venueSchema.communityVenues)
    .where(eq(venueSchema.communityVenues.id, place.id));
  assert.equal(stored!.status, "deleted");
  assert.equal(stored!.version, 2);
  assert.ok(stored!.deletedAt);
  await assert.rejects(
    db
      .update(venueSchema.communityVenues)
      .set({ status: "published", deletedAt: null })
      .where(eq(venueSchema.communityVenues.id, place.id)),
  );
});
test("bounds, category, free and literal-text search apply consistently to venues and events", async () => {
  const free = await service.create(owner, { ...input(), name: "100% 신나는_공원" });
  await service.create(owner, {
    ...input(),
    name: "멀리 있는 공원",
    latitude: 38.5,
    longitude: 128.5,
  });
  await service.create(owner, {
    ...input(),
    name: "유료 스포츠 홀",
    categorySlug: "sports",
    isFree: false,
  });
  const freeEvent = await event({ title: "100% 신나는_이벤트" });
  await event({ amountKRW: 15000, category: "sports" });
  await event({ latitude: 38.5, longitude: 128.5 });
  const result = await service.list(null, {
    south: 37.5,
    west: 126.9,
    north: 37.6,
    east: 127,
    category: "party",
    freeOnly: true,
  });
  assert.deepEqual(
    result.venues.map((v) => v.id),
    [free.id],
  );
  assert.deepEqual(
    result.events.map((v) => v.id),
    [freeEvent],
  );
  const literal = await service.list(null, { q: "% 신나는_" });
  assert.equal(literal.totalVenues, 1);
  assert.equal(literal.totalEvents, 1);
  assert.equal((await service.list(null, { q: "없는 결과" })).totalEvents, 0);
  const venueOnly = await service.list(null, { mode: "place" });
  assert.equal(venueOnly.totalEvents, 0);
  assert.deepEqual(venueOnly.events, []);
  const eventOnly = await service.list(null, { mode: "event" });
  assert.equal(eventOnly.totalVenues, 0);
  assert.deepEqual(eventOnly.venues, []);
});
test("event map includes ongoing and unscheduled events while excluding samples, missing locations and past events", async () => {
  const upcoming = await event({ open: false });
  const ongoing = await event({
    startsAt: new Date(Date.now() - 3600000),
    endsAt: new Date(Date.now() + 3600000),
  });
  const unscheduled = await event({ startsAt: null });
  const lightning = await event({
    meetupType: "lightning",
    endsAt: new Date(Date.now() + 7200000),
  });
  await event({ sample: true });
  await event({ latitude: null, longitude: null });
  await event({ startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() - 1800000) });
  await event({ startsAt: new Date(Date.now() - 3600000) });
  await event({ deleted: true });
  const result = await service.list(null, { mode: "event" });
  assert.deepEqual(
    new Set(result.events.map((v) => v.id)),
    new Set([upcoming, ongoing, unscheduled, lightning]),
  );
  assert.equal(result.events.find((v) => v.id === upcoming)!.open, false);
  assert.equal(result.events.find((v) => v.id === ongoing)!.open, false);
  assert.equal(result.events.find((v) => v.id === unscheduled)!.open, true);
  assert.equal(result.events.find((v) => v.id === unscheduled)!.startsAt, null);
  assert.equal(result.events.find((v) => v.id === lightning)!.meetupType, "lightning");
  for (const secret of [
    owner,
    "contactInfo",
    "applicationUrl",
    "bodyMarkdown",
    "01012345678",
    "questions",
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
});
test("map recruitment closes at capacity and reopens after a confirmed attendee cancels", async () => {
  const id = await event({ capacity: 1 });
  await db
    .update(baseSchema.posts)
    .set({ applicationUrl: null })
    .where(eq(baseSchema.posts.id, id));
  assert.equal((await service.list(null)).events.find((entry) => entry.id === id)!.open, true);
  const [application] = await db
    .insert(baseSchema.eventApplications)
    .values({
      postId: id,
      userId: other,
      attendeeName: "참가자",
      contact: "01012345678",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    })
    .returning();
  const full = await service.list(null);
  assert.equal(full.totalEvents, 1);
  assert.equal(full.events[0]!.open, false);
  await db
    .update(baseSchema.eventApplications)
    .set({ status: "cancelled" })
    .where(eq(baseSchema.eventApplications.id, application!.id));
  assert.equal((await service.list(null)).events[0]!.open, true);
});
test("map recruitment counts active payment reservations but ignores expired holds", async () => {
  const held = await event({ capacity: 1, amountKRW: 10000 });
  const expired = await event({ capacity: 1, amountKRW: 10000 });
  for (const [id, expiresAt] of [
    [held, new Date(Date.now() + 60000)],
    [expired, new Date(Date.now() - 60000)],
  ] as const) {
    await db
      .update(baseSchema.posts)
      .set({ applicationUrl: null })
      .where(eq(baseSchema.posts.id, id));
    await db.insert(baseSchema.eventApplications).values({
      postId: id,
      userId: other,
      attendeeName: "결제 대기 참가자",
      contact: "01012345678",
      amountKRW: 10000,
      status: "pending_payment",
      refundConsentAt: new Date(),
      expiresAt,
    });
  }
  const entries = new Map((await service.list(null)).events.map((entry) => [entry.id, entry]));
  assert.equal(entries.get(held)!.open, false);
  assert.equal(entries.get(expired)!.open, true);
});
test("large maps cap pin payloads while reporting accurate totals and retaining both kinds", async () => {
  await db.insert(venueSchema.communityVenues).values(
    Array.from({ length: 205 }, (_, i) => ({
      ...input(),
      name: `공유 장소 ${i}`,
      ownerId: owner,
    })),
  );
  const venueOnly = await service.list(null, { mode: "place" });
  assert.equal(venueOnly.venues.length, 200);
  assert.equal(venueOnly.totalVenues, 205);
  assert.equal(venueOnly.truncated, true);
  await event();
  const combined = await service.list(null);
  assert.equal(combined.venues.length, 199);
  assert.equal(combined.events.length, 1);
  assert.equal(combined.totalVenues, 205);
  assert.equal(combined.totalEvents, 1);
  assert.equal(combined.truncated, true);
});
test("per-member venue registration is bounded and deletion does not reset the daily limit", async () => {
  await db.insert(venueSchema.communityVenues).values(
    Array.from({ length: 50 }, (_, i) => ({
      ...input(),
      name: `나의 장소 ${i}`,
      ownerId: owner,
    })),
  );
  await assert.rejects(service.create(owner, input()), code("RATE_LIMITED"));
  const mine = (await service.list(owner)).venues[0]!;
  await service.remove(owner, mine.id, { version: 1 });
  await assert.rejects(service.create(owner, input()), code("RATE_LIMITED"));
  assert.equal((await service.create(other, input())).isOwner, true);
});
test("database rejects invalid venue identities, ranges and lifecycle state even without the service", async () => {
  const raw = { ...input(), ownerId: owner };
  for (const patch of [
    { ownerId: null },
    { latitude: 91 },
    { longitude: Number.NaN },
    { categorySlug: "crew" as const },
    { status: "deleted" as const },
    { version: 0 },
    { capacity: 5001 },
  ])
    await assert.rejects(db.insert(venueSchema.communityVenues).values({ ...raw, ...patch }));
  const place = await service.create(owner, input());
  await assert.rejects(
    db
      .update(venueSchema.communityVenues)
      .set({ ownerId: other })
      .where(eq(venueSchema.communityVenues.id, place.id)),
  );
  await assert.rejects(
    db
      .update(venueSchema.communityVenues)
      .set({ id: randomUUID() })
      .where(eq(venueSchema.communityVenues.id, place.id)),
  );
  await assert.rejects(
    db.insert(venueSchema.venueRecommendations).values({ venueId: place.id, userId: randomUUID() }),
  );
});
test("account removal keeps the private venue ledger, clears recommendations and removes public discovery", async () => {
  const place = await service.create(owner, input());
  await service.recommend(owner, place.id, { liked: true });
  await pg.query("delete from auth.users where id=$1", [owner]);
  await assert.rejects(
    service.detail(null, place.id),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND",
  );
  assert.equal(
    (await service.list(null, { mode: "place" })).venues.some((venue) => venue.id === place.id),
    false,
  );
  const [stored] = await db
    .select()
    .from(venueSchema.communityVenues)
    .where(eq(venueSchema.communityVenues.id, place.id));
  assert.equal(stored!.ownerId, null);
  assert.equal(stored!.name, place.name);
  const recommendations = await db
    .select()
    .from(venueSchema.venueRecommendations)
    .where(eq(venueSchema.venueRecommendations.venueId, place.id));
  assert.equal(recommendations.length, 0);
});
test("new venue tables enable RLS and remain inaccessible to Supabase browser roles", async () => {
  const result = await pg.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='sliper' and relname in ('community_venues','venue_recommendations') order by relname",
  );
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.relrowsecurity));
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(pg.query("select * from sliper.community_venues"));
    } finally {
      await pg.exec("reset role");
    }
  }
});
