import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import type { CommunityPost, FeedQuery } from "../src/domain/community";
import { CATEGORIES } from "../src/domain/categories";
import { EARTH_RADIUS_KM, kilometersBetween } from "../src/domain/location";
import { communityService, feedQuerySchema } from "../src/server/community-service";
import { AppError } from "../src/server/errors";
import { matchesPostQuery, reconcilePosts } from "../src/lib/community-state";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = communityService(db as unknown as Database);
const isValidation = (error: unknown) => error instanceof AppError && error.code === "VALIDATION";
let owner: string, guest: string;
const location = { latitude: 37.5, longitude: 127 };
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
async function event(
  options: {
    latitude?: number | null;
    longitude?: number | null;
    startsAt?: string | null;
    amountKRW?: number;
    capacity?: number;
    open?: boolean;
    meetupType?: "event" | "lightning";
    createdAt?: string;
    featured?: boolean;
    category?: "party" | "sports";
    title?: string;
    settings?: boolean;
    external?: boolean;
  } = {},
) {
  const id = randomUUID();
  await pg.query(
    "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,is_anonymous,created_at,featured,tags,event_fee) values ($1,$2,$3,'모집',$4,'함께 게임을 해요',true,$5::timestamptz,$6,ARRAY['친구'],$7)",
    [
      id,
      owner,
      options.category ?? "party",
      options.title ?? "동네 게임",
      options.createdAt ?? "2026-01-01T00:00:00.000001Z",
      options.featured ?? false,
      options.meetupType === "lightning" ? "무료" : null,
    ],
  );
  if (options.settings !== false)
    await pg.query(
      "insert into sliper.event_settings (post_id,amount_krw,capacity,open,starts_at,venue_latitude,venue_longitude,meetup_type,ends_at,created_at) values ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::varchar,case when $8::varchar='lightning' then $5::timestamptz+interval '1 hour' else null end,case when $8::varchar='lightning' then $5::timestamptz-interval '1 day' else statement_timestamp() end)",
      [
        id,
        options.amountKRW ?? 0,
        options.capacity ?? 4,
        options.open ?? true,
        options.startsAt === undefined ? "2040-01-02T12:00:00+09:00" : options.startsAt,
        options.latitude === undefined ? location.latitude : options.latitude,
        options.longitude === undefined ? location.longitude : options.longitude,
        options.meetupType ?? "event",
      ],
    );
  if (options.external)
    await pg.query(
      "update sliper.posts set application_url='https://example.com/events' where id=$1",
      [id],
    );
  return id;
}
async function application(postId: string, status: string, expiresAt: string | null = null) {
  const user = await member("참가자");
  await pg.query(
    "insert into sliper.event_applications (post_id,user_id,attendee_name,contact,amount_krw,status,expires_at,confirmed_at,source,external_reference) values ($1,$2,'참가자','test-contact',0,$3::varchar,case when $3::varchar='pending_approval' then null else coalesce($4::timestamptz,'2040-01-01T00:00:00Z'::timestamptz) end,case when $3::varchar='confirmed' then statement_timestamp() else null end,case when $3::varchar='pending_approval' then 'external' else 'site' end,case when $3::varchar='pending_approval' then $2::uuid::text else null end)",
    [postId, user, status, expiresAt],
  );
}
const ids = (items: CommunityPost[]) => items.map((item) => item.id);

before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("비공개 행사장 주최자");
  guest = await member("방문자");
});
after(() => pg.close());

test("nearby query validation preserves zero and explicit false and rejects incomplete or invalid preferences", () => {
  const parsed = feedQuerySchema.parse({
    latitude: "0",
    longitude: "0",
    radiusKm: "0.1",
    eventOnly: "false",
    availableOnly: "false",
    minPriceKRW: "0",
    maxPriceKRW: "0",
    sort: "nearest",
  });
  assert.equal(parsed.latitude, 0);
  assert.equal(parsed.longitude, 0);
  assert.equal(parsed.eventOnly, false);
  assert.equal(parsed.availableOnly, false);
  assert.equal(parsed.maxPriceKRW, 0);
  for (const invalid of [
    { latitude: 0 },
    { longitude: 0 },
    { sort: "nearest" },
    { radiusKm: 1 },
    { ...location, radiusKm: 0 },
    { ...location, radiusKm: 101 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: -181 },
    { latitude: "", longitude: "" },
    { latitude: true, longitude: 0 },
    { eventOnly: "1" },
    { availableOnly: "no" },
    { minPriceKRW: "" },
    { minPriceKRW: 1.5 },
    { minPriceKRW: 10, maxPriceKRW: 9 },
    { fromDate: "2040-02-30" },
    { fromDate: "2040-02-02", toDate: "2040-02-01" },
    { authorId: owner },
  ])
    assert.equal(feedQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("ordinary feed preserves old posts while location searches return only mapped recruitment and public venue data", async () => {
  const mapped = await event();
  const noCoordinates = await event({ latitude: null, longitude: null });
  const legacy = await event({ settings: false });
  const story = await service.createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "오늘의 이야기",
    bodyMarkdown: "안녕하세요",
    isAnonymous: true,
    imageAssetIds: [],
  });
  const all = await service.feed(null);
  assert.deepEqual(new Set(ids(all.posts)), new Set([mapped, noCoordinates, legacy, story.id]));
  assert.equal(all.posts.find((item) => item.id === legacy)?.distanceKm, null);
  assert.deepEqual(
    new Set(ids((await service.feed(null, { meetupType: "event" })).posts)),
    new Set([mapped, noCoordinates, legacy]),
  );
  const nearby = await service.feed(null, { ...location, radiusKm: 1 });
  assert.deepEqual(ids(nearby.posts), [mapped]);
  assert.equal(nearby.posts[0]?.distanceKm, 0);
  assert.equal(nearby.posts[0]?.venueLatitude, location.latitude);
  const serialized = JSON.stringify(nearby.posts);
  for (const value of [owner, "비공개 행사장 주최자", "authorId", '"latitude"', '"longitude"'])
    assert.equal(serialized.includes(value), false);
});

test("nearest pagination orders the entire result by precise distance and stable microsecond ties after anchor deletion", async () => {
  const center = await event({ createdAt: "2026-01-01T00:00:00.123456Z" });
  const tieLater = await event({ createdAt: "2026-01-01T00:00:00.123457Z" });
  const tieEarlier = await event({ createdAt: "2026-01-01T00:00:00.123455Z" });
  const tiny = await event({ latitude: location.latitude + 0.00000001 });
  const far = await event({
    latitude: location.latitude + 0.2,
    createdAt: "2027-01-01T00:00:00.000001Z",
  });
  const first = await service.feed(null, { ...location, sort: "nearest", limit: 2 });
  assert.deepEqual(ids(first.posts), [tieLater, center]);
  assert.ok(first.nextCursor);
  assert.equal(first.posts[1]?.createdAt, "2026-01-01T00:00:00.123456Z");
  await pg.query("update sliper.posts set status='deleted' where id=$1", [center]);
  await event({ createdAt: "2026-01-01T00:00:00.999999Z" });
  const remaining: CommunityPost[] = [];
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page = await service.feed(null, { ...location, sort: "nearest", limit: 1, cursor });
    remaining.push(...page.posts);
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids(remaining), [tieEarlier, tiny, far]);
  assert.ok(remaining[1]!.distanceKm! > 0 && remaining[1]!.distanceKm! < 0.001);
  assert.equal(new Set(ids([...first.posts, ...remaining])).size, 5);
});

test("radius filtering uses inclusive straight-line kilometers and handles poles and the date line", async () => {
  const near = await event({ latitude: location.latitude + 180 / Math.PI / EARTH_RADIUS_KM });
  await event({ latitude: location.latitude + 1 });
  const measured = (await service.feed(null, { ...location, sort: "nearest" })).posts[0]!
    .distanceKm!;
  assert.ok(Math.abs(measured - 1) < 1e-9);
  assert.deepEqual(ids((await service.feed(null, { ...location, radiusKm: measured })).posts), [
    near,
  ]);
  assert.equal(
    (await service.feed(null, { ...location, radiusKm: measured - 1e-8 })).posts.length,
    0,
  );
  const dateline = await event({ latitude: 0, longitude: -179.99 });
  assert.deepEqual(
    ids((await service.feed(null, { latitude: 0, longitude: 179.99, radiusKm: 3 })).posts),
    [dateline],
  );
  const pole = await event({ latitude: 90, longitude: 80 });
  assert.deepEqual(
    ids((await service.feed(null, { latitude: 90, longitude: -100, radiusKm: 0.1 })).posts),
    [pole],
  );
  assert.ok(Number.isFinite(kilometersBetween(0, 0, 0, 180)));
});

test("date, price, category, and lightning preferences combine and exclude unknown schedule or fees", async () => {
  const match = await event({
    startsAt: "2040-01-01T15:00:00Z",
    amountKRW: 0,
    meetupType: "lightning",
    category: "sports",
  });
  await event({
    startsAt: "2040-01-01T14:59:59Z",
    amountKRW: 0,
    meetupType: "lightning",
    category: "sports",
  });
  await event({
    startsAt: "2040-01-02T15:00:00Z",
    amountKRW: 0,
    meetupType: "lightning",
    category: "sports",
  });
  await event({
    startsAt: "2040-01-01T15:00:00Z",
    amountKRW: 1001,
    category: "sports",
  });
  await event({ startsAt: "2040-01-01T15:00:00Z", amountKRW: 1000, category: "sports" });
  await event({ startsAt: null, amountKRW: 1000, category: "sports" });
  await event({ settings: false, category: "sports" });
  const query: FeedQuery = {
    eventOnly: true,
    meetupType: "lightning",
    fromDate: "2040-01-02",
    toDate: "2040-01-02",
    minPriceKRW: 0,
    maxPriceKRW: 0,
    category: "sports",
    search: "동네",
    tag: "친구",
  };
  assert.deepEqual(ids((await service.feed(null, query)).posts), [match]);
  const free = await event({ amountKRW: 0, startsAt: null });
  const freePosts = (await service.feed(null, { eventOnly: true, maxPriceKRW: 0 })).posts;
  assert.ok(ids(freePosts).includes(free));
  assert.ok(freePosts.every((item) => item.eventAmountKRW === 0));
});

test("available-only excludes closed, started, confirmed-full, and held-full events but expired holds free seats", async () => {
  const available = await event({ capacity: 1 });
  const expiredHold = await event({ capacity: 1 });
  const full = await event({ capacity: 1 });
  const held = await event({ capacity: 1 });
  const manual = await event({ capacity: 1, external: true });
  await application(full, "confirmed");
  await application(held, "pending_payment", "2040-01-01T00:00:00Z");
  await application(expiredHold, "pending_payment", "2020-01-01T00:00:00Z");
  await application(manual, "pending_approval");
  await event({ open: false });
  await event({ startsAt: "2020-01-01T12:00:00+09:00" });
  const results = await service.feed(null, { eventOnly: true, availableOnly: true });
  assert.deepEqual(new Set(ids(results.posts)), new Set([available, expiredHold, manual]));
  assert.ok(results.posts.every((item) => item.eventAvailable === true));
  assert.equal(
    (await service.feed(null, { eventOnly: true, availableOnly: false })).posts.length,
    7,
  );
});

test("distance cursor scope binds coordinates and every event preference and rejects malformed or modified payloads", async () => {
  for (let i = 0; i < 3; i++) await event({ latitude: location.latitude + i / 1000 });
  const first = await service.feed(owner, { ...location, sort: "nearest", limit: 1 });
  assert.ok(first.nextCursor);
  for (const changed of [
    { latitude: location.latitude + 0.001 },
    { longitude: location.longitude + 0.001 },
    { radiusKm: 10 },
    { eventOnly: true },
    { meetupType: "event" as const },
    { fromDate: "2040-01-01" },
    { toDate: "2040-01-03" },
    { minPriceKRW: 0 },
    { maxPriceKRW: 100 },
    { availableOnly: true },
    { category: "party" as const },
    { sort: "latest" as const },
  ])
    await assert.rejects(
      service.feed(owner, { ...location, sort: "nearest", ...changed, cursor: first.nextCursor! }),
      isValidation,
    );
  await assert.rejects(
    service.feed(guest, { ...location, sort: "nearest", cursor: first.nextCursor! }),
    isValidation,
  );
  const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()) as Record<
    string,
    unknown
  >;
  for (const change of [
    { distanceKm: -1 },
    { distanceKm: null },
    { distanceKm: 20021 },
    { at: "2026-02-30T00:00:00.000001Z" },
    { id: "invalid" },
    { unknown: true },
  ]) {
    const altered = Buffer.from(JSON.stringify({ ...cursor, ...change })).toString("base64url");
    await assert.rejects(
      service.feed(owner, { ...location, sort: "nearest", cursor: altered }),
      isValidation,
    );
  }
  await assert.rejects(
    service.feed(owner, { ...location, sort: "nearest", cursor: "x".repeat(1025) }),
  );
});

test("event preferences retain private bookmarks, popular ranking, and unfiltered featured highlights", async () => {
  const bookmarked = await event({ latitude: location.latitude + 0.01 });
  const liked = await event({ latitude: location.latitude + 0.02, featured: true });
  await event({ latitude: location.latitude + 0.03 });
  await service.react(guest, bookmarked, "bookmark", true);
  await service.react(guest, liked, "like", true);
  assert.deepEqual(ids((await service.feed(guest, { ...location, view: "bookmarks" })).posts), [
    bookmarked,
  ]);
  assert.equal((await service.feed(owner, { ...location, view: "bookmarks" })).posts.length, 0);
  const nearby = await service.feed(null, { ...location, sort: "popular", radiusKm: 10 });
  assert.equal(nearby.posts[0]?.id, liked);
  assert.deepEqual(ids(nearby.featured), [liked]);
  assert.equal(nearby.featured[0]?.distanceKm, null);
  // Recruitment stays in event discovery; today's hot section contains stories only.
  assert.equal(nearby.hot?.length, 0);
});

test("client reconciliation recomputes distances after writes and preserves advanced filters and literal false", async () => {
  const id = await event({ meetupType: "lightning" });
  const current = (await service.feed(null, { ...location, sort: "nearest" })).posts[0]!;
  const changed = { ...(await service.getPost(id, null)), likes: 1 };
  assert.equal(changed.distanceKm, null);
  const query: FeedQuery = {
    ...location,
    sort: "nearest",
    radiusKm: 1,
    meetupType: "lightning",
    maxPriceKRW: 0,
    availableOnly: true,
  };
  const reconciled = reconcilePosts(
    [current],
    new Map([[id, { version: 1, post: changed }]]),
    query,
  );
  assert.equal(reconciled[0]?.distanceKm, 0);
  assert.equal(reconciled[0]?.likes, 1);
  const moved = { ...changed, venueLatitude: location.latitude + 1 };
  assert.equal(
    reconcilePosts([current], new Map([[id, { version: 2, post: moved }]]), query).length,
    0,
  );
  assert.equal(
    matchesPostQuery({ ...current, eventAvailable: false }, {
      availableOnly: "false",
    } as unknown as FeedQuery),
    true,
  );
  assert.equal(
    matchesPostQuery({ ...current, eventAvailable: false }, {
      availableOnly: "true",
    } as unknown as FeedQuery),
    false,
  );
  assert.equal(
    matchesPostQuery(
      { ...current, eventStartsAt: "2040-01-01T15:00:00Z" },
      { fromDate: "2040-01-02", toDate: "2040-01-02" },
    ),
    true,
  );
});

test("conversion to a story keeps historical settings but hides obsolete public event metadata", async () => {
  const id = await event({ amountKRW: 3000 });
  const recruitment = await service.getPost(id, owner);
  assert.equal(recruitment.venueLatitude, location.latitude);
  const story = await service.updatePost(owner, {
    postId: id,
    expectedUpdatedAt: recruitment.updatedAt,
    categorySlug: "party",
    kind: "이야기",
    title: "모집 대신 나눌 이야기",
    bodyMarkdown: "오늘은 이야기만 나눠요.",
    isAnonymous: true,
    imageAssetIds: [],
  });
  const settings = (
    await pg.query<{ venue_latitude: number; amount_krw: number }>(
      "select venue_latitude,amount_krw from sliper.event_settings where post_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(settings?.venue_latitude, location.latitude);
  assert.equal(settings?.amount_krw, 3000);
  const listed = (await service.feed(null, { kind: "이야기" })).posts.find(
    (post) => post.id === id,
  )!;
  for (const post of [story, listed, await service.getPost(id, null)]) {
    assert.equal(post.meetupType, "event");
    assert.equal(post.venueLatitude, null);
    assert.equal(post.venueLongitude, null);
    assert.equal(post.eventStartsAt, null);
    assert.equal(post.eventAmountKRW, null);
    assert.equal(post.distanceKm, null);
    assert.equal(post.eventAvailable, false);
  }
  assert.equal((await service.feed(null, { ...location, sort: "nearest" })).posts.length, 0);
});
