import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { libraryEntries, libraryAccessRequests } from "../src/db/library-schema";
import { memberBlocks, memberSafety, contentRestrictions } from "../src/db/safety-schema";
import { categorySubscriptions, hostSubscriptions } from "../src/db/engagement-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { emptyEventPlan } from "../src/domain/event-plan";
import {
  TOPICS,
  topicsForTags,
  topicAliases,
  topicQuerySchema,
  topicUrl,
} from "../src/domain/topics";
import { topicService } from "../src/server/topic-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  service = topicService(db as unknown as Database);
let owner: string, viewer: string;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
async function post(extra: Partial<typeof base.posts.$inferInsert> = {}) {
  const [row] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      categorySlug: "mind-games",
      title: "추리게임 진행 이야기",
      bodyMarkdown: "새로운 게임의 진행 방법을 공유해요.",
      tags: ["추리게임"],
      ...extra,
    })
    .returning();
  return row!;
}
async function library(extra: Partial<typeof libraryEntries.$inferInsert> = {}) {
  const [row] = await db
    .insert(libraryEntries)
    .values({
      ownerId: owner,
      kind: "template",
      categorySlug: "mind-games",
      title: "추리 게임 진행 자료",
      summary: "게임 진행에 필요한 공개 소개입니다.",
      tags: ["추리게임"],
      eventPlan: {
        ...emptyEventPlan(),
        concept: "PROTECTED_EVENT_PLAN_CONCEPT",
        reference: { ...emptyEventPlan().reference, location: "PROTECTED_PRIVATE_VENUE" },
      },
      scenario: "PROTECTED_SCENARIO_ONLY_FOR_BUYERS",
      rules: "PROTECTED_RULES_ONLY_FOR_BUYERS",
      hostGuide: "PROTECTED_HOST_GUIDE_ONLY_FOR_BUYERS",
      materials: ["PROTECTED_MATERIAL"],
      rounds: [{ name: "PROTECTED_ROUND", seconds: 300 }],
      minPlayers: 4,
      maxPlayers: 10,
      durationMinutes: 60,
      priceKRW: 12000,
      purchaseUrl: "https://example.invalid/purchase",
      ...extra,
    })
    .returning();
  return row!;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = await member("게임 주최자");
  viewer = await member("관심 회원");
});
after(() => pg.close());
test("curated aliases normalize case, whitespace and hash; ambiguous aliases and title guessing are absent", () => {
  assert.deepEqual(
    topicsForTags([" #미션 레이스 ", "MISSION-RACE", "미션레이스"]).map((topic) => topic.slug),
    ["mission-race"],
  );
  assert.deepEqual(topicsForTags(["나의 런닝맨 후기", "마피아꿀팁"]), []);
  assert.deepEqual(
    topicsForTags(["# 추리"]).map((topic) => topic.slug),
    ["mystery"],
  );
  const aliases = TOPICS.flatMap(topicAliases);
  assert.equal(new Set(aliases).size, aliases.length);
  assert.equal(topicQuerySchema.safeParse({ storiesPage: "0" }).success, false);
  assert.equal(topicQuerySchema.safeParse({ libraryPage: "101" }).success, false);
  assert.equal(topicQuerySchema.safeParse({ pageSize: 100000 }).success, false);
  assert.equal(
    topicUrl("mystery", { focus: "interests", storiesPage: 2, libraryPage: 1 }),
    "/topics/mystery?focus=interests&storiesPage=2",
  );
});
test("explicit tags connect each source once and preserve legacy topic fields, kinds and cross-category stories", async () => {
  const linked = await post({
    tags: [" #추리 게임 ", "마피아"],
    topic: "rules",
    categorySlug: "knowledge",
  });
  await post({ tags: [], title: "추리게임과 크라임씬", bodyMarkdown: "마피아 추리게임 본문" });
  await post({ tags: ["추리게임 후기"] });
  const event = await post({
    kind: "모집",
    isAnonymous: true,
    location: "공개 행사 장소",
    contactInfo: "PRIVATE_EVENT_PHONE",
    tags: ["MYSTERY"],
  });
  await library({ tags: ["마피아", "추리게임"] });
  const result = await service.detail(viewer, "mystery");
  assert.equal(result.stories.total, 1);
  assert.equal(result.stories.items[0]?.id, linked.id);
  assert.equal(result.recruitment.total, 1);
  assert.equal(result.recruitment.items[0]?.id, event.id);
  assert.equal(result.recruitment.items[0]?.author, "익명");
  assert.equal(result.library.total, 1);
  for (const secret of [
    owner,
    viewer,
    "PRIVATE_EVENT_PHONE",
    "bodyDocument",
    "sourceRecordPostId",
    "eventPlan",
    "payload",
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  const [unchanged] = await db
    .select({ topic: base.posts.topic })
    .from(base.posts)
    .where(eq(base.posts.id, linked.id));
  assert.equal(unchanged?.topic, "rules");
});
test("topic counts and pages share hide, deletion, bidirectional block and inactive member visibility", async () => {
  const keep = await post(),
    hidden = await post();
  await post({ status: "deleted", deletedAt: new Date() });
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: hidden.id, reason: "검토" });
  const hiddenLibrary = await library();
  await library({ status: "draft" });
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: hiddenLibrary.id, reason: "검토" });
  const inactive = await member("탈퇴한 작성자");
  await post({ authorId: inactive });
  await library({ ownerId: inactive });
  await db.insert(memberSafety).values({ userId: inactive, status: "closed" });
  let result = await service.detail(viewer, "mystery");
  assert.equal(result.stories.total, 1);
  assert.equal(result.stories.items[0]?.id, keep.id);
  assert.equal(result.library.total, 0);
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: viewer, displayLabel: "회원" });
  result = await service.detail(viewer, "mystery");
  assert.equal(result.stories.total, 0);
  assert.deepEqual(result.stories.items, []);
  assert.equal((await service.detail(null, "mystery")).stories.total, 1);
});
test("topic tag relationships exclude spoilers; paid summaries never expand protected plans for buyers", async () => {
  await post({
    title: "SECRET_ANSWER_TITLE",
    bodyMarkdown: "SECRET_ANSWER_BODY ![PHOTO](https://example.invalid/secret.jpg)",
    spoiler: true,
    spoilerTitle: "추리 게임의 반전을 이야기해요",
    spoilerSummary: "정답이 포함된 후기예요.",
  });
  const paid = await library();
  const before = await service.detail(viewer, "mystery");
  assert.equal(before.stories.total, 0);
  assert.deepEqual(before.stories.items, []);
  await db.insert(libraryAccessRequests).values({
    entryId: paid.id,
    userId: viewer,
    externalReference: "test-purchase-reference",
    amountKRW: 12000,
    status: "approved",
  });
  const after = await service.detail(viewer, "mystery");
  for (const result of [before, after, await service.detail(null, "mystery")]) {
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes("SECRET_ANSWER"), false);
    assert.equal(encoded.includes("secret.jpg"), false);
    assert.equal(encoded.includes("PROTECTED_"), false);
    assert.equal(encoded.includes("externalReference"), false);
  }
  assert.deepEqual(after.library, before.library);
});
test("topic interest feed never identifies anonymous hosts and never writes subscription or push state", async () => {
  const visible = await post({ isAnonymous: false }),
    anonymous = await post({ isAnonymous: true });
  let result = await service.detail(viewer, "mystery", { focus: "interests" });
  assert.equal(result.interestFeed, "setup");
  assert.equal(result.stories.total, 2);
  assert.equal(
    (await service.detail(null, "mystery", { focus: "interests" })).interestFeed,
    "login",
  );
  await db.insert(hostSubscriptions).values({ userId: viewer, hostId: owner });
  result = await service.detail(viewer, "mystery", { focus: "interests" });
  assert.equal(result.interestFeed, "personalized");
  assert.deepEqual(
    result.stories.items.map((row) => row.id),
    [visible.id],
  );
  await db.insert(categorySubscriptions).values({ userId: viewer, categorySlug: "mind-games" });
  result = await service.detail(viewer, "mystery", { focus: "interests" });
  assert.equal(result.stories.total, 2);
  assert.ok(result.stories.items.some((row) => row.id === anonymous.id && row.author === "익명"));
  assert.equal((await db.select().from(categorySubscriptions)).length, 1);
  assert.equal((await db.select().from(hostSubscriptions)).length, 1);
  const pushes = await pg.query<{ count: number }>(
    "select count(*)::int as count from sliper.push_subscriptions",
  );
  assert.equal(pushes.rows[0]?.count, 0);
});
test("sections paginate independently with stable ties, normalized aliases and visible totals", async () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const ids = [];
  for (let i = 0; i < 14; i++)
    ids.push((await post({ createdAt: at, tags: [i % 2 ? "#마피아" : " 추리 게임 "] })).id);
  for (let i = 0; i < 13; i++) await library({ createdAt: at });
  const first = await service.detail(viewer, "mystery");
  const second = await service.detail(viewer, "mystery", {
    storiesPage: 2,
    libraryPage: 2,
    recruitmentPage: 100,
  });
  assert.equal(first.stories.items.length, 12);
  assert.equal(first.library.items.length, 12);
  assert.equal(second.stories.items.length, 2);
  assert.equal(second.library.items.length, 1);
  assert.equal(second.recruitment.page, 1);
  assert.equal(first.stories.total, 14);
  assert.equal(first.stories.pageCount, 2);
  assert.deepEqual(
    [...first.stories.items, ...second.stories.items].map((row) => row.id),
    ids.sort().reverse(),
  );
  assert.equal(
    new Set([...first.library.items, ...second.library.items].map((row) => row.id)).size,
    13,
  );
  const clamped = await service.detail(viewer, "mystery", { storiesPage: 100 });
  assert.equal(clamped.query.storiesPage, 2);
  assert.deepEqual(clamped.stories.items, second.stories.items);
});
test("unknown topics and invalid input fail without query fallback; closed viewers cannot personalize", async () => {
  await assert.rejects(
    service.detail(null, "nonexistent"),
    (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND",
  );
  await assert.rejects(service.detail(null, "mystery", { storiesPage: 10000 }));
  await assert.rejects(service.detail(null, "mystery", { focus: "push" }));
  await db.insert(memberSafety).values({ userId: viewer, status: "closed" });
  await assert.rejects(
    service.detail(viewer, "mystery"),
    (error: unknown) => error instanceof AppError && error.code === "FORBIDDEN",
  );
});
