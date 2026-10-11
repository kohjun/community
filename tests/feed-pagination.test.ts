import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import type { CommunityPost } from "../src/domain/community";
import { CATEGORIES, type CategorySlug } from "../src/domain/categories";
import { communityService, feedQuerySchema } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = communityService(db as unknown as Database);
let owner: string, other: string;
const ids = (items: CommunityPost[]) => items.map((item) => item.id);
const pageQuery = { page: 1, limit: 20 };

async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}

async function stories(
  count: number,
  options: {
    author?: string;
    category?: CategorySlug;
    kind?: "이야기" | "후기" | "모집";
    featured?: boolean;
    title?: string;
    topic?: string;
    tags?: string[];
  } = {},
) {
  const result: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = randomUUID();
    await pg.query(
      "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,created_at,featured,topic,tags) values ($1,$2,$3,$4,$5,'함께 게임을 준비해요','2026-01-01T00:00:00.123455Z'::timestamptz+($6::int%3)*interval '1 microsecond',$7,$8,$9::text[])",
      [
        id,
        options.author ?? owner,
        options.category ?? "party",
        options.kind ?? "이야기",
        options.title ?? `자유 이야기 ${index}`,
        index,
        options.featured ?? false,
        options.topic ?? null,
        options.tags ?? [],
      ],
    );
    result.push(id);
  }
  return result;
}

async function expectedOrder(where = "true", order = "created_at desc, id desc") {
  return (
    await pg.query<{ id: string }>(
      `select id from sliper.posts where status='published' and ${where} order by ${order}`,
    )
  ).rows.map((row) => row.id);
}

before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("이야기 작성자");
  other = await member("다른 작성자");
});
after(() => pg.close());

test("numbered feed validates page numbers and keeps cursor and numbered modes exclusive", () => {
  assert.equal(feedQuerySchema.parse({ page: "2" }).page, 2);
  assert.equal(feedQuerySchema.parse({}).page, undefined);
  for (const invalid of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: 1000001 },
    { page: "" },
    { page: "Infinity" },
    { page: true },
    { page: 1, cursor: "abc" },
  ])
    assert.equal(feedQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("45 stories paginate 20/20/5 with precise stable ties and no missing or duplicated posts", async () => {
  await stories(45);
  const expected = await expectedOrder();
  const pages = await Promise.all(
    [1, 2, 3].map((page) => service.feed(null, { ...pageQuery, page })),
  );
  assert.deepEqual(
    pages.map((page) => page.posts.length),
    [20, 20, 5],
  );
  assert.deepEqual(
    pages.flatMap((page) => ids(page.posts)),
    expected,
  );
  assert.equal(new Set(pages.flatMap((page) => ids(page.posts))).size, 45);
  for (let index = 0; index < pages.length; index++) {
    assert.deepEqual(pages[index]?.pagination, {
      page: index + 1,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    });
    assert.equal(pages[index]?.nextCursor, null);
  }
  assert.match(pages[0]!.posts[0]!.createdAt, /\.123457Z$/);
});

test("numbered totals preserve the home featured exclusion and story filter while hiding deleted content", async () => {
  await stories(25);
  const featured = await stories(3, { featured: true });
  const deleted = await stories(1);
  await service.deletePost(owner, deleted[0]!);
  const home = await service.feed(null, pageQuery);
  assert.equal(home.pagination?.totalItems, 25);
  assert.equal(
    home.posts.some((post) => post.featured),
    false,
  );
  assert.deepEqual(new Set(ids(home.featured)), new Set(featured));
  const story = await service.feed(null, { ...pageQuery, kind: "이야기" });
  assert.equal(story.pagination?.totalItems, 28);
  assert.equal(story.pagination?.totalPages, 2);
  // Posts without reactions are not promoted into today's hot stories.
  assert.equal(story.hot?.length, 0);
});

test("category, story and review, topic, tag and escaped search all contribute to numbered totals", async () => {
  const matching = await stories(7, {
    kind: "후기",
    topic: "미션",
    tags: ["런닝맨"],
    title: "준비 100% 조건 대상",
  });
  const discussion = await stories(2, {
    topic: "미션",
    tags: ["런닝맨"],
    title: "준비 100% 조건 대상",
  });
  await stories(3, {
    category: "sports",
    topic: "미션",
    tags: ["런닝맨"],
    title: "준비 100% 조건 대상",
  });
  await stories(4, { topic: "벌칙", title: "준비 100% 조건 대상" });
  await stories(3, { topic: "미션", tags: ["런닝맨"], title: "준비 1000 조건 대상" });
  const query = {
    ...pageQuery,
    kind: "이야기" as const,
    category: "party" as const,
    topic: "미션",
    tag: "런닝맨",
    search: "100%",
    limit: 4,
  };
  const pages = await Promise.all([1, 2, 3].map((page) => service.feed(null, { ...query, page })));
  assert.deepEqual(
    pages.map((page) => page.posts.length),
    [4, 4, 1],
  );
  assert.equal(pages[0]?.pagination?.totalItems, 9);
  assert.deepEqual(
    new Set(pages.flatMap((page) => ids(page.posts))),
    new Set([...matching, ...discussion]),
  );
});

test("mine and bookmarks totals are limited to the authenticated viewer", async () => {
  const mine = await stories(23);
  const theirs = await stories(5, { author: other });
  await db
    .insert(schema.bookmarks)
    .values([
      ...mine.slice(0, 2).map((postId) => ({ postId, userId: owner })),
      ...theirs.slice(0, 4).map((postId) => ({ postId, userId: owner })),
      { postId: mine[2]!, userId: other },
    ]);
  const myPage = await service.feed(owner, { ...pageQuery, page: 2, view: "mine" });
  assert.equal(myPage.pagination?.totalItems, 23);
  assert.equal(myPage.posts.length, 3);
  assert.equal(
    myPage.posts.every((post) => post.isMine),
    true,
  );
  const saved = await service.feed(owner, { ...pageQuery, view: "bookmarks" });
  assert.equal(saved.pagination?.totalItems, 6);
  assert.equal(
    saved.posts.every((post) => post.isBookmarked),
    true,
  );
  const otherSaved = await service.feed(other, { ...pageQuery, view: "bookmarks" });
  assert.equal(otherSaved.pagination?.totalItems, 1);
  assert.equal(otherSaved.posts[0]?.id, mine[2]);
  await assert.rejects(
    service.feed(null, { ...pageQuery, view: "mine" }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
});

test("popular numbered pages preserve like ranking and stable timestamp and ID ties", async () => {
  const items = await stories(45);
  await db
    .insert(schema.postLikes)
    .values([
      ...items.slice(0, 22).map((postId) => ({ postId, userId: owner })),
      ...items.slice(0, 12).map((postId) => ({ postId, userId: other })),
    ]);
  const expected = await expectedOrder(
    "true",
    "(select count(*) from sliper.post_likes l where l.post_id=sliper.posts.id) desc, created_at desc, id desc",
  );
  const pages = await Promise.all(
    [1, 2, 3].map((page) => service.feed(null, { ...pageQuery, page, sort: "popular" })),
  );
  assert.deepEqual(
    pages.flatMap((page) => ids(page.posts)),
    expected,
  );
  assert.equal(pages[0]?.pagination?.totalItems, 45);
  assert.equal(pages[0]?.posts[0]?.likes, 2);
  assert.equal(pages[2]?.posts.at(-1)?.likes, 0);
});

test("nearest numbered totals include the same mapped event, radius, KST date, price and capacity filters", async () => {
  const items = await stories(45, { kind: "모집" });
  const startsAt = new Date("2040-01-01T15:30:00Z");
  await db.insert(schema.eventSettings).values(
    items.map((postId, index) => ({
      postId,
      amountKRW: 0,
      capacity: 6,
      startsAt,
      venueLatitude: 37.5 + Math.floor(index / 3) * 0.0001,
      venueLongitude: 127,
    })),
  );
  const excluded = await stories(4, { kind: "모집" });
  await db.insert(schema.eventSettings).values([
    {
      postId: excluded[0]!,
      startsAt,
      amountKRW: 0,
      capacity: 6,
      venueLatitude: 38.5,
      venueLongitude: 127,
    },
    {
      postId: excluded[1]!,
      startsAt,
      amountKRW: 1000,
      capacity: 6,
      venueLatitude: 37.5,
      venueLongitude: 127,
    },
    {
      postId: excluded[2]!,
      startsAt,
      amountKRW: 0,
      capacity: 6,
      open: false,
      venueLatitude: 37.5,
      venueLongitude: 127,
    },
    { postId: excluded[3]!, startsAt, amountKRW: 0, capacity: 6 },
  ]);
  const query = {
    ...pageQuery,
    latitude: 37.5,
    longitude: 127,
    sort: "nearest" as const,
    radiusKm: 1,
    meetupType: "event" as const,
    fromDate: "2040-01-02",
    toDate: "2040-01-02",
    minPriceKRW: 0,
    maxPriceKRW: 0,
    availableOnly: true,
  };
  const pages = await Promise.all([1, 2, 3].map((page) => service.feed(null, { ...query, page })));
  const actual = pages.flatMap((page) => page.posts);
  assert.deepEqual(
    pages.map((page) => page.posts.length),
    [20, 20, 5],
  );
  assert.deepEqual(new Set(ids(actual)), new Set(items));
  assert.equal(pages[0]?.pagination?.totalItems, 45);
  for (let index = 1; index < actual.length; index++) {
    const previous = actual[index - 1]!;
    const current = actual[index]!;
    assert.ok(previous.distanceKm! <= current.distanceKm!);
    if (previous.distanceKm === current.distanceKm)
      assert.ok(
        previous.createdAt > current.createdAt ||
          (previous.createdAt === current.createdAt && previous.id > current.id),
      );
  }
});

test("empty and deleted final pages clamp to a valid page while cursor mode stays compatible", async () => {
  const empty = await service.feed(null, { ...pageQuery, page: 999 });
  assert.deepEqual(empty.pagination, { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
  assert.deepEqual(empty.posts, []);
  await stories(45);
  const last = await service.feed(null, { ...pageQuery, page: 3 });
  for (const post of last.posts) await service.deletePost(owner, post.id);
  const clamped = await service.feed(null, { ...pageQuery, page: 3 });
  assert.deepEqual(clamped.pagination, { page: 2, pageSize: 20, totalItems: 40, totalPages: 2 });
  assert.equal(clamped.posts.length, 20);
  assert.equal((await service.feed(null, { page: 2 })).pagination?.pageSize, 24);
  const cursorFirst = await service.feed(null, { limit: 20 });
  assert.equal(cursorFirst.pagination, undefined);
  assert.ok(cursorFirst.nextCursor);
  const cursorSecond = await service.feed(null, { limit: 20, cursor: cursorFirst.nextCursor! });
  assert.equal(cursorSecond.pagination, undefined);
  assert.equal(cursorSecond.nextCursor, null);
  assert.equal(new Set([...ids(cursorFirst.posts), ...ids(cursorSecond.posts)]).size, 40);
});
