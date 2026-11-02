import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { memberBlocks, contentRestrictions } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { communityQueries, cacheableFeed } from "../src/server/community-queries";
import { communityService, feedQuerySchema } from "../src/server/community-service";
import { discoveryCache, invalidateDiscoveryCache } from "../src/server/discovery-cache-store";
let sqlReads = 0;
const pg = new PGlite(),
  db = drizzle(pg, {
    logger: {
      logQuery() {
        sqlReads++;
      },
    },
  }),
  database = db as unknown as Database,
  queries = communityQueries(database),
  service = communityService(database);
let owner: string, a: string, b: string;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  invalidateDiscoveryCache(database);
  [owner, a, b] = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of [owner, a, b]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({ id, nickname: "캐시검증회원" });
  }
});
after(() => pg.close());
async function post(title = "캐시 검증 이야기") {
  const [p] = await db
    .insert(schema.posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      kind: "이야기",
      title,
      bodyMarkdown: "캐시 검증 공개 본문",
      isAnonymous: false,
    })
    .returning();
  return p!;
}
const q = { page: 1, limit: 20 } as const;
test("public cache shares expensive projection but overlays each member's live reactions and authorship", async () => {
  const p = await post();
  await db.insert(schema.postLikes).values({ postId: p.id, userId: a });
  await db.insert(schema.bookmarks).values({ postId: p.id, userId: b });
  const guest = await queries.feed(null, q),
    first = await queries.feed(a, q),
    second = await queries.feed(b, q),
    mine = await queries.feed(owner, q);
  assert.equal(guest.posts[0]!.isLiked, false);
  assert.equal(first.posts[0]!.isLiked, true);
  assert.equal(first.posts[0]!.isBookmarked, false);
  assert.equal(second.posts[0]!.isLiked, false);
  assert.equal(second.posts[0]!.isBookmarked, true);
  assert.equal(mine.posts[0]!.isMine, true);
  first.posts[0]!.title = "caller mutation";
  assert.equal((await queries.feed(null, q)).posts[0]!.title, p.title);
  assert.ok(discoveryCache(database).stats().hits >= 3);
  await db.delete(schema.postLikes).where(eq(schema.postLikes.userId, a));
  assert.equal((await queries.feed(a, q)).posts[0]!.isLiked, false);
});
test("warm cache immediately respects hide, edit, deletion and nickname changes without waiting for TTL", async () => {
  const p = await post();
  await queries.feed(null, q);
  await db
    .update(schema.profiles)
    .set({ nickname: "새닉네임" })
    .where(eq(schema.profiles.id, owner));
  assert.equal((await queries.feed(null, q)).posts[0]!.author, "새닉네임");
  await db
    .update(schema.posts)
    .set({ title: "수정한 제목", updatedAt: new Date(Date.now() + 1) })
    .where(eq(schema.posts.id, p.id));
  assert.equal((await queries.feed(null, q)).posts[0]!.title, "수정한 제목");
  await queries.feed(null, q);
  await db.insert(contentRestrictions).values({
    targetType: "post",
    targetId: p.id,
    hidden: true,
    reason: "격리 검사",
    updatedBy: owner,
  });
  assert.equal((await queries.feed(null, q)).posts.length, 0);
  await db.delete(contentRestrictions);
  await queries.feed(null, q);
  await db.delete(schema.posts).where(eq(schema.posts.id, p.id));
  assert.equal((await queries.feed(null, q)).posts.length, 0);
});
test("a member block bypasses shared pages and preserves personalized totals", async () => {
  await post();
  await queries.feed(null, q);
  await db
    .insert(memberBlocks)
    .values({ blockerId: a, blockedId: owner, displayLabel: "검사 작성자" });
  const value = await queries.feed(a, q);
  assert.equal(value.posts.length, 0);
  assert.equal(value.pagination!.totalItems, 0);
  assert.equal((await queries.feed(b, q)).posts.length, 1);
});
test("cached first-page cursors remain bound to their viewer; personal/search/location requests bypass caching", async () => {
  await post("첫번째 이야기");
  await post("두번째 이야기");
  const first = await queries.feed(a, { limit: 1 });
  assert.ok(first.nextCursor);
  assert.equal((await queries.feed(a, { limit: 1, cursor: first.nextCursor! })).posts.length, 1);
  await assert.rejects(queries.feed(b, { limit: 1, cursor: first.nextCursor! }));
  for (const input of [
    { view: "mine" },
    { view: "bookmarks" },
    { focus: "interests" },
    { focus: "unanswered" },
    { search: "찾기" },
    { latitude: 37, longitude: 127 },
    { page: 6 },
  ])
    assert.equal(cacheableFeed(feedQuerySchema.parse(input)), false);
});
test("a successful post mutation clears warmed discovery while read-only counters do not", async () => {
  await post();
  await queries.feed(null, q);
  assert.ok(discoveryCache(database).stats().entries > 0);
  await service.createPost(owner, {
    categorySlug: "party",
    kind: "이야기",
    title: "새로 등록한 이야기",
    bodyMarkdown: "캐시 무효화 동작 확인",
    isAnonymous: true,
  });
  assert.equal(discoveryCache(database).stats().entries, 0);
  assert.equal((await queries.feed(null, q)).pagination!.totalItems, 2);
});

test("empty public stories reuse the short cache without an unnecessary permission query", async () => {
  assert.deepEqual(await queries.homeStories(null, { period: "today" }), []);
  const before = sqlReads;
  assert.deepEqual(await queries.homeStories(a, { period: "today" }), []);
  assert.equal(sqlReads, before);
});
