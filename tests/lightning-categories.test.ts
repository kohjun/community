import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import type { CommunityPost, FeedQuery } from "../src/domain/community";
import { lightningInputSchema } from "../src/domain/discovery";
import {
  LIGHTNING_CATEGORY_SLUGS,
  lightningCategorySchema,
  type LightningCategorySlug,
} from "../src/domain/lightning-categories";
import { matchesPostQuery } from "../src/lib/community-state";
import { communityService, feedQuerySchema } from "../src/server/community-service";
import { AppError } from "../src/server/errors";
import { lightningService } from "../src/server/lightning-service";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const lightning = lightningService(db as unknown as Database);
const community = communityService(db as unknown as Database);
const location = { latitude: 37.5, longitude: 127 };
const ids = (posts: CommunityPost[]) => posts.map((post) => post.id);
const isValidation = (error: unknown) => error instanceof AppError && error.code === "VALIDATION";
let owner: string;

function input() {
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  return {
    categorySlug: "party",
    title: "동네 보드게임 번개",
    description: "함께 보드게임을 즐길 동네 친구들을 모집합니다.",
    location: "동네 보드게임 카페",
    venue: location,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    capacity: 4,
    priceKRW: 0,
    applicationUrl: null,
  };
}

async function event(
  options: {
    meetupType?: "event" | "lightning";
    activityCategory?: LightningCategorySlug | null;
    categorySlug?: "party" | "sports";
    tags?: string[];
    latitude?: number;
    createdAt?: string;
    settings?: boolean;
  } = {},
) {
  const id = randomUUID();
  await pg.query(
    "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,is_anonymous,event_fee,tags,created_at) values ($1,$2,$3,'모집','동네 보드게임 번개','동네에서 함께 게임을 즐겨요',true,'무료',$4,$5::timestamptz)",
    [
      id,
      owner,
      options.categorySlug ?? "party",
      options.tags ?? [],
      options.createdAt ?? "2026-01-01T00:00:00.000001Z",
    ],
  );
  if (options.settings !== false)
    await pg.query(
      "insert into sliper.event_settings (post_id,meetup_type,activity_category,amount_krw,capacity,open,starts_at,ends_at,venue_latitude,venue_longitude,created_at) values ($1,$2,$3,0,4,true,'2040-01-02T12:00:00+09:00',case when $2::varchar='lightning' then '2040-01-02T13:00:00+09:00'::timestamptz else null end,$4,$5,'2040-01-01T12:00:00+09:00')",
      [
        id,
        options.meetupType ?? "lightning",
        options.activityCategory ?? null,
        options.latitude ?? location.latitude,
        location.longitude,
      ],
    );
  return id;
}

before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = randomUUID();
  await pg.query("insert into auth.users values ($1)", [owner]);
  await db.insert(schema.profiles).values({
    id: owner,
    nickname: "번개 주최자",
    phoneNumber: "01012345678",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
});
after(() => pg.close());

test("lightning activity categories accept the complete taxonomy independently of required community topics", () => {
  assert.equal(LIGHTNING_CATEGORY_SLUGS.length, 13);
  for (const activityCategory of LIGHTNING_CATEGORY_SLUGS) {
    assert.equal(lightningCategorySchema.parse(activityCategory), activityCategory);
    assert.equal(
      lightningInputSchema.parse({ ...input(), activityCategory }).activityCategory,
      activityCategory,
    );
  }
  const defaults = lightningInputSchema.parse(input());
  assert.equal(defaults.activityCategory, undefined);
  assert.deepEqual(defaults.activityTags, []);
  const { categorySlug: _categorySlug, ...withoutTopic } = input();
  for (const invalid of [
    { ...input(), activityCategory: "party" },
    { ...input(), activityCategory: "unknown" },
    { ...input(), activityCategory: null },
    { ...input(), categorySlug: "games", activityCategory: "games" },
    { ...withoutTopic, activityCategory: "games" },
  ])
    assert.equal(lightningInputSchema.safeParse(invalid).success, false);
});

test("activity tags trim before uniqueness validation and enforce count and length boundaries", () => {
  assert.deepEqual(
    lightningInputSchema.parse({ ...input(), activityTags: [" 방탈출 ", "보드게임"] }).activityTags,
    ["방탈출", "보드게임"],
  );
  assert.equal(
    lightningInputSchema.safeParse({
      ...input(),
      activityTags: ["가", "나", "다", "라", "마".repeat(24)],
    }).success,
    true,
  );
  for (const activityTags of [
    ["보드게임", "보드게임"],
    [" 보드게임 ", "보드게임"],
    [""],
    ["   "],
    ["가".repeat(25)],
    ["가", "나", "다", "라", "마", "바"],
    [null],
  ])
    assert.equal(lightningInputSchema.safeParse({ ...input(), activityTags }).success, false);
});

test("lightning creation persists the activity category and normalized tags without replacing the community topic", async () => {
  const { postId } = await lightning.create(owner, {
    ...input(),
    activityCategory: "games",
    activityTags: [" 방탈출 ", "보드게임"],
  });
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, postId));
  const [settings] = await db
    .select()
    .from(schema.eventSettings)
    .where(eq(schema.eventSettings.postId, postId));
  assert.equal(post?.categorySlug, "party");
  assert.deepEqual(post?.tags, ["방탈출", "보드게임"]);
  assert.equal(settings?.activityCategory, "games");
  const publicPost = await community.getPost(postId, null);
  assert.equal(publicPost.category, "party");
  assert.equal(publicPost.meetupType, "lightning");
  assert.equal(publicPost.activityCategory, "games");
  assert.deepEqual(publicPost.tags, ["방탈출", "보드게임"]);
  assert.deepEqual(
    ids(
      (
        await community.feed(null, {
          meetupType: "lightning",
          activityCategory: "games",
          category: "party",
          tag: "방탈출",
        })
      ).posts,
    ),
    [postId],
  );
});

test("omitted and legacy lightning categories project as other while ordinary posts project null", async () => {
  const created = await lightning.create(owner, input());
  const [settings] = await db
    .select()
    .from(schema.eventSettings)
    .where(eq(schema.eventSettings.postId, created.postId));
  assert.equal(settings?.activityCategory, "other");
  const legacy = await event();
  const normal = await event({ meetupType: "event" });
  const unconfigured = await event({ settings: false });
  const story = await community.createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "동네 이야기",
    bodyMarkdown: "좋아하는 동네 활동을 이야기해요.",
    isAnonymous: true,
    imageAssetIds: [],
  });
  assert.equal(story.activityCategory, null);
  const feed = await community.feed(null);
  for (const postId of [created.postId, legacy]) {
    assert.equal((await community.getPost(postId, null)).activityCategory, "other");
    assert.equal(feed.posts.find((post) => post.id === postId)?.activityCategory, "other");
  }
  assert.deepEqual((await community.getPost(created.postId, null)).tags, []);
  for (const postId of [normal, unconfigured, story.id]) {
    assert.equal((await community.getPost(postId, null)).activityCategory, null);
    assert.equal(feed.posts.find((post) => post.id === postId)?.activityCategory, null);
  }
});

test("database category constraints accept every activity slug and reject unknown or ordinary event categories", async () => {
  const lightningId = await event();
  for (const activityCategory of LIGHTNING_CATEGORY_SLUGS)
    await pg.query("update sliper.event_settings set activity_category=$2 where post_id=$1", [
      lightningId,
      activityCategory,
    ]);
  await assert.rejects(
    pg.query("update sliper.event_settings set activity_category='unknown' where post_id=$1", [
      lightningId,
    ]),
    { code: "23514" },
  );
  await pg.query("update sliper.event_settings set activity_category=null where post_id=$1", [
    lightningId,
  ]);
  const normalId = await event({ meetupType: "event" });
  await assert.rejects(
    pg.query("update sliper.event_settings set activity_category='other' where post_id=$1", [
      normalId,
    ]),
    { code: "23514" },
  );
  assert.equal((await community.getPost(lightningId, null)).activityCategory, "other");
  assert.equal((await community.getPost(normalId, null)).activityCategory, null);
});

test("activity feed validation requires an explicit lightning scope and rejects invalid categories", () => {
  const parsed = feedQuerySchema.parse({ meetupType: "lightning", activityCategory: "games" });
  assert.equal(parsed.meetupType, "lightning");
  assert.equal(parsed.activityCategory, "games");
  for (const invalid of [
    { activityCategory: "games" },
    { eventOnly: true, activityCategory: "games" },
    { meetupType: "event", activityCategory: "games" },
    { meetupType: "lightning", activityCategory: "party" },
    { meetupType: "lightning", activityCategory: "unknown" },
    { meetupType: "lightning", activityCategory: null },
  ])
    assert.equal(feedQuerySchema.safeParse(invalid).success, false);
});

test("activity feeds combine topic and tag filters and include legacy lightning only in other", async () => {
  const games = await event({ activityCategory: "games", tags: ["보드게임"] });
  const sportsTopicGames = await event({ activityCategory: "games", categorySlug: "sports" });
  const other = await event({ activityCategory: "other" });
  const legacy = await event();
  const normal = await event({ meetupType: "event" });
  await event({ settings: false });
  assert.deepEqual(
    new Set(
      ids(
        (await community.feed(null, { meetupType: "lightning", activityCategory: "games" })).posts,
      ),
    ),
    new Set([games, sportsTopicGames]),
  );
  for (const query of [
    { meetupType: "lightning", activityCategory: "other" },
    { ...location, sort: "nearest", meetupType: "lightning", activityCategory: "other" },
  ] satisfies FeedQuery[])
    assert.deepEqual(
      new Set(ids((await community.feed(null, query)).posts)),
      new Set([other, legacy]),
    );
  assert.deepEqual(
    ids(
      (
        await community.feed(null, {
          meetupType: "lightning",
          activityCategory: "games",
          category: "party",
          tag: "보드게임",
        })
      ).posts,
    ),
    [games],
  );
  const page = await community.feed(null, {
    meetupType: "lightning",
    activityCategory: "other",
    page: 1,
    limit: 1,
  });
  assert.equal(page.posts.length, 1);
  assert.equal(page.pagination?.totalItems, 2);
  assert.ok(!ids(page.posts).includes(normal));
});

test("latest, popular, and nearest cursors bind the activity category and continue the original category", async () => {
  const gameIds: string[] = [];
  for (let i = 0; i < 3; i++)
    gameIds.push(
      await event({
        activityCategory: "games",
        latitude: location.latitude + i / 1000,
        createdAt: `2026-01-0${i + 1}T00:00:00.000001Z`,
      }),
    );
  await event({ activityCategory: "other" });
  for (const sort of ["latest", "popular", "nearest"] as const) {
    const query: FeedQuery = {
      meetupType: "lightning",
      activityCategory: "games",
      sort,
      limit: 1,
      ...(sort === "nearest" ? location : {}),
    };
    const first = await community.feed(null, query);
    assert.ok(first.nextCursor);
    for (const activityCategory of ["other", undefined] as const)
      await assert.rejects(
        community.feed(null, { ...query, activityCategory, cursor: first.nextCursor }),
        isValidation,
      );
    const remaining = await community.feed(null, { ...query, limit: 10, cursor: first.nextCursor });
    assert.equal(remaining.nextCursor, null);
    assert.deepEqual(new Set(ids([...first.posts, ...remaining.posts])), new Set(gameIds));
    assert.equal(remaining.posts.length, 2);
  }
});

test("client activity matching agrees with server feeds for explicit, legacy, and ordinary posts", async () => {
  await event({ activityCategory: "games", tags: ["보드게임"] });
  await event({ activityCategory: "games", categorySlug: "sports" });
  await event({ activityCategory: "other" });
  const legacyId = await event();
  await event({ meetupType: "event" });
  const all = (await community.feed(null)).posts;
  for (const query of [
    { meetupType: "lightning", activityCategory: "games" },
    { meetupType: "lightning", activityCategory: "other" },
    { meetupType: "lightning", activityCategory: "games", category: "party", tag: "보드게임" },
    { ...location, sort: "nearest", meetupType: "lightning", activityCategory: "other" },
  ] satisfies FeedQuery[])
    assert.deepEqual(
      new Set(ids(all.filter((post) => matchesPostQuery(post, query)))),
      new Set(ids((await community.feed(null, query)).posts)),
    );
  const legacy = all.find((post) => post.id === legacyId)!;
  assert.equal(
    matchesPostQuery(
      { ...legacy, activityCategory: null },
      { meetupType: "lightning", activityCategory: "other" },
    ),
    true,
  );
  assert.equal(
    matchesPostQuery(
      { ...legacy, activityCategory: null },
      { meetupType: "lightning", activityCategory: "games" },
    ),
    false,
  );
});

test("lightning text search finds activity tags with literal SQL wildcard characters and keeps ordinary search semantics", async () => {
  const tagged = await event({ activityCategory: "games", tags: ["야간암벽", "사진%_산책"] });
  const wildcardLookalike = await event({ activityCategory: "other", tags: ["사진AB산책"] });
  const normal = await event({ meetupType: "event", tags: ["야간암벽", "사진%_산책"] });
  const all = (await community.feed(null)).posts;
  for (const query of [
    { meetupType: "lightning", search: "야간암벽" },
    { meetupType: "lightning", activityCategory: "games", search: "야간암벽" },
    { meetupType: "lightning", search: "사진%_산책" },
    { meetupType: "lightning", search: "%_" },
  ] satisfies FeedQuery[]) {
    const matches = (await community.feed(null, query)).posts;
    assert.deepEqual(ids(matches), [tagged]);
    assert.deepEqual(ids(all.filter((post) => matchesPostQuery(post, query))), [tagged]);
    assert.ok(!ids(matches).includes(wildcardLookalike));
    assert.ok(!ids(matches).includes(normal));
  }
  for (const query of [
    { search: "야간암벽" },
    { meetupType: "event", search: "야간암벽" },
    { search: "사진%_산책" },
    { meetupType: "event", search: "사진%_산책" },
  ] satisfies FeedQuery[]) {
    assert.deepEqual(ids((await community.feed(null, query)).posts), []);
    assert.deepEqual(ids(all.filter((post) => matchesPostQuery(post, query))), []);
  }
  assert.deepEqual(
    new Set(ids((await community.feed(null, { search: "보드게임" })).posts)),
    new Set([tagged, wildcardLookalike, normal]),
  );
  assert.deepEqual(
    ids((await community.feed(null, { meetupType: "event", search: "보드게임" })).posts),
    [normal],
  );
});
