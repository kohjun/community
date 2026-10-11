import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { libraryEntries } from "../src/db/library-schema";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { escapeSearchLike, searchHref, searchInputSchema } from "../src/domain/search";
import { searchService } from "../src/server/search-service";
const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = searchService(db as unknown as Database);
let owner: string, reader: string;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname, phoneNumber: "01012345678" });
  return id;
}
async function post(input: Partial<typeof schema.posts.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.posts)
    .values({
      categorySlug: "party",
      authorId: owner,
      title: "함께 미션 파티",
      bodyMarkdown: "즐겁게 미션을 풀어보는 이야기입니다.",
      kind: "이야기",
      ...input,
    })
    .returning({ id: schema.posts.id });
  return row!.id;
}
async function entry(input: Partial<typeof libraryEntries.$inferInsert> = {}) {
  const [row] = await db
    .insert(libraryEntries)
    .values({
      ownerId: owner,
      kind: "rulebook",
      categorySlug: "party",
      title: "미션 룰북",
      summary: "팀별로 미션을 해결하고 마지막 라운드에 우승팀을 가리는 게임입니다.",
      scenario: "SECRET-SCENARIO 시나리오는 구매자에게만 공개하는 데이터입니다.",
      rules: "SECRET-RULES 정해진 라운드의 규칙을 지켜야 합니다.",
      hostGuide: "SECRET-GUIDE 참여자의 정체를 드러내지 말고 시작하세요.",
      materials: ["SECRET-MATERIAL"],
      rounds: [{ name: "SECRET-ROUND", seconds: 300 }],
      tags: ["실내"],
      minPlayers: 4,
      maxPlayers: 12,
      durationMinutes: 60,
      ...input,
    })
    .returning({ id: libraryEntries.id });
  return row!.id;
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
  owner = await member("실제 작성자");
  reader = await member("검색 독자");
});
after(() => pg.close());
test("search validates lengths, types, pagination and Unicode without expanding SQL wildcards", () => {
  for (const input of [
    { q: "x".repeat(101) },
    { q: "\u0000" },
    { q: "hi\u0000there" },
    { q: "\uD800" },
    { q: "\uDC00" },
    { type: "private" },
    { category: "secret" },
    { page: "0" },
    { page: "51" },
    { page: "1.5" },
    { page: "NaN" },
    { ownerId: randomUUID() },
  ])
    assert.equal(searchInputSchema.safeParse(input).success, false);
  assert.equal(searchInputSchema.parse({ q: "  미션 🎉  " }).q, "미션 🎉");
  assert.equal(searchInputSchema.parse({ q: "기", page: "2", category: "" }).page, 2);
  assert.equal(escapeSearchLike("%_\\"), "\\%\\_\\\\");
  const link = searchHref(
    { q: "미션 & 파티?", type: "all", page: 1 },
    { type: "rulebook", category: "party", page: 2 },
  );
  const url = new URL(link, "https://example.test");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("q"), "미션 & 파티?");
  assert.equal(url.searchParams.get("type"), "rulebook");
});
test("empty search has no trending data or counts and does not query the database", async () => {
  const noQueries = searchService({
    transaction: () => {
      throw new Error("Should not query");
    },
  } as unknown as Database);
  const result = await noQueries.search(null, { q: " ", page: 3 });
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
  assert.equal(result.page, 1);
});
test("one search returns stories, recruitments and public library summaries with correct links", async () => {
  const storyId = await post({ isAnonymous: true });
  const eventId = await post({ title: "미션 참가자를 모집합니다", kind: "모집" });
  const rulebookId = await entry();
  const templateId = await entry({ kind: "template" });
  const result = await service.search(null, { q: "미션" });
  assert.equal(result.total, 4);
  assert.deepEqual(result.counts, {
    all: 4,
    story: 1,
    recruitment: 1,
    rulebook: 1,
    template: 1,
    record: 0,
  });
  assert.equal(result.items.find((item) => item.id === storyId)?.href, `/posts/${storyId}`);
  assert.equal(result.items.find((item) => item.id === eventId)?.href, `/posts/${eventId}`);
  assert.equal(result.items.find((item) => item.id === rulebookId)?.href, `/archive/${rulebookId}`);
  assert.equal(result.items.find((item) => item.id === templateId)?.href, `/archive/${templateId}`);
  assert.equal(result.items.find((item) => item.id === storyId)?.author, "익명");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(owner), false);
  assert.equal(serialized.includes("01012345678"), false);
  assert.equal(serialized.includes("SECRET"), false);
});
test("private paid library payload is excluded from matching and DTOs even for its owner", async () => {
  await entry({ priceKRW: 15000, purchaseUrl: "https://example.com/buy" });
  for (const actor of [null, owner, reader]) {
    assert.equal((await service.search(actor, { q: "SECRET" })).total, 0);
    const [item] = (await service.search(actor, { q: "룰북" })).items;
    assert.ok(item);
    assert.equal(Object.hasOwn(item, "scenario"), false);
    assert.equal(Object.hasOwn(item, "purchaseUrl"), false);
    assert.equal(Object.hasOwn(item, "payload"), false);
  }
});
test("type and category filters preserve matching counts and include reviews and polls under stories", async () => {
  await post();
  await post({ kind: "후기", categorySlug: "travel" });
  await post({ kind: "투표", poll: { question: "미션 할까요?", options: ["찬성", "반대"] } });
  await post({ kind: "모집" });
  await entry();
  const stories = await service.search(null, { q: "미션", type: "story" });
  assert.equal(stories.total, 3);
  assert.ok(stories.items.every((item) => item.type === "story"));
  assert.equal(stories.counts.all, 5);
  const travel = await service.search(null, { q: "미션", category: "travel" });
  assert.equal(travel.total, 1);
  assert.ok(travel.items.every((item) => item.category === "travel"));
});
test("hidden, deleted and blocked records stay out of both counts and all result pages", async () => {
  const hidden = await post();
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: hidden, hidden: true, reason: "검토 중" });
  const deleted = await post();
  await db.update(schema.posts).set({ status: "deleted" }).where(eq(schema.posts.id, deleted));
  const deletedEntry = await entry();
  await db
    .update(libraryEntries)
    .set({ status: "deleted" })
    .where(eq(libraryEntries.id, deletedEntry));
  await post({ isAnonymous: true });
  await entry();
  assert.equal((await service.search(null, { q: "미션" })).total, 2);
  await db
    .insert(memberBlocks)
    .values({ blockerId: reader, blockedId: owner, displayLabel: "익명 사용자" });
  assert.equal((await service.search(reader, { q: "미션" })).total, 0);
  assert.equal((await service.search(null, { q: "미션" })).total, 2);
});
test("literal wildcard, SQL-looking text, one-character Korean and case-insensitive tags are safe matches", async () => {
  await post({
    title: "100%_완료",
    bodyMarkdown: "역슬래시 \\ 를 써봅니다.",
    tags: ["RunningMan"],
  });
  await post({ title: "보통 글", bodyMarkdown: "평범한 이야기" });
  assert.equal((await service.search(null, { q: "%_" })).total, 1);
  assert.equal((await service.search(null, { q: "\\" })).total, 1);
  assert.equal((await service.search(null, { q: "runningman" })).total, 1);
  assert.equal((await service.search(null, { q: "글" })).total, 1);
  assert.equal((await service.search(null, { q: "%' OR true --" })).total, 0);
});
test("search slices at 20 records, clamps obsolete pages and never repeats page boundaries", async () => {
  const startsAt = Date.UTC(2026, 0, 1);
  for (let index = 0; index < 23; index++)
    await post({
      title: `페이지 미션 ${index}`,
      createdAt: new Date(startsAt + index * 1000),
    });
  const first = await service.search(null, { q: "페이지" });
  const second = await service.search(null, { q: "페이지", page: 2 });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.equal(first.pageCount, 2);
  assert.equal(first.total, 23);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 23);
  assert.equal(first.items[0]?.title, "페이지 미션 22");
  assert.equal((await service.search(null, { q: "페이지", page: 50 })).page, 2);
});

test("archive search never exposes private drafts or entries from unavailable or mutually blocked authors", async () => {
  const hiddenDraft = await entry({ status: "draft", title: "비공개 초안미션" });
  for (const actor of [null, owner, reader]) {
    const result = await service.search(actor, { q: "초안미션" });
    assert.equal(result.total, 0);
    assert.equal(JSON.stringify(result).includes(hiddenDraft), false);
  }
  const published = await entry({ title: "발행된 자료미션" });
  assert.equal((await service.search(reader, { q: "자료미션" })).total, 1);
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: reader, displayLabel: "독자 차단" });
  assert.equal((await service.search(reader, { q: "자료미션" })).total, 0);
  assert.equal((await service.search(null, { q: "자료미션" })).total, 1);
  await db.delete(memberBlocks);
  await db.insert(memberSafety).values({ userId: owner, status: "closed" });
  for (const actor of [null, reader]) {
    const result = await service.search(actor, { q: "자료미션" });
    assert.equal(result.total, 0);
    assert.equal(JSON.stringify(result).includes(published), false);
  }
  await db.delete(memberSafety);
  await db.update(libraryEntries).set({ ownerId: null }).where(eq(libraryEntries.id, published));
  assert.equal((await service.search(null, { q: "자료미션" })).total, 0);
});
