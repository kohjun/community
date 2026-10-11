import assert from "node:assert/strict";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as engagement from "../src/db/engagement-schema";
import * as safety from "../src/db/safety-schema";
import { pushDeliveries, pushSubscriptions } from "../src/db/push-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { communityService } from "../src/server/community-service";
import { searchService } from "../src/server/search-service";
import { engagementService } from "../src/server/engagement-service";
import { readPublicPostShare } from "../src/server/post-sharing-reader";
import { createPostSchema } from "../src/domain/validation";
import { previewPost } from "../src/domain/discussions";
import { communityLocation, communityLocationUrl } from "../src/domain/community-location";
import { reconcilePosts } from "../src/lib/community-state";
import { AppError } from "../src/server/errors";
import { pushDispatcher } from "../src/server/push-dispatcher";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const service = communityService(connection);
let owner: string, writer: string, viewer: string;
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
const input = (extra: Record<string, unknown> = {}) => ({
  categorySlug: "party",
  kind: "이야기",
  title: "미션을 설계할 때 궁금한 점",
  bodyMarkdown: "어떻게 진행하면 좋을까요?",
  ...extra,
});
async function question(extra: Record<string, unknown> = {}) {
  return service.createPost(owner, input({ discussionType: "question", ...extra }));
}
async function answer(postId: string, actor = writer) {
  return (
    await service.createComment(actor, {
      postId,
      bodyMarkdown: "미션을 세 단계로 나누어 보세요.",
      isAnonymous: true,
    })
  ).comment;
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
  owner = await member("질문 작성자");
  writer = await member("답변 작성자");
  viewer = await member("독자 회원");
});
after(() => pg.close());
test("legacy stories default to free while board topics, reviews and subtype filters remain independent", async () => {
  const old = await service.createPost(owner, input());
  const q = await question();
  const tip = await service.createPost(
    owner,
    input({ categorySlug: "knowledge", topic: "규칙", discussionType: "tip" }),
  );
  const review = await service.createPost(owner, input({ kind: "후기" }));
  assert.equal(old.discussionType, "free");
  assert.equal(tip.topic, "규칙");
  assert.equal(review.discussionType, null);
  assert.deepEqual(
    (await service.feed(viewer, { kind: "이야기", discussionType: "free" })).posts.map((p) => p.id),
    [old.id],
  );
  assert.deepEqual(
    (await service.feed(viewer, { discussionType: "question" })).posts.map((p) => p.id),
    [q.id],
  );
  assert.equal((await service.feed(viewer, { kind: "이야기" })).posts.length, 4);
  assert.equal(
    (await searchService(connection).search(viewer, { q: "미션", discussionType: "tip" })).items[0]
      ?.id,
    tip.id,
  );
  assert.equal(
    createPostSchema.safeParse(input({ kind: "후기", discussionType: "question" })).success,
    false,
  );
});
test("only author can accept a visible non-self answer on the same question, with version conflict protection", async () => {
  const q = await question(),
    other = await question(),
    a = await answer(q.id),
    own = await answer(q.id, owner),
    foreign = await answer(other.id);
  const select = (actor: string | null, commentId: string | null, revision = q.updatedAt) =>
    service.resolveQuestion(actor, q.id, { commentId, expectedUpdatedAt: revision });
  await assert.rejects(select(null, a.id), code("UNAUTHENTICATED"));
  await assert.rejects(select(writer, a.id), code("FORBIDDEN"));
  await assert.rejects(select(owner, own.id), code("VALIDATION"));
  await assert.rejects(select(owner, foreign.id), code("VALIDATION"));
  const chosen = await select(owner, a.id);
  assert.equal(chosen.post.acceptedAnswerId, a.id);
  assert.equal(chosen.acceptedAnswer?.author, "익명");
  assert.equal(JSON.stringify(chosen).includes(writer), false);
  await assert.rejects(select(owner, null), code("CONFLICT"));
  assert.equal(
    (await service.feed(viewer, { focus: "unanswered" })).posts.some((p) => p.id === q.id),
    false,
  );
  const reset = await select(owner, null, chosen.post.updatedAt);
  assert.equal(reset.post.acceptedAnswerId, null);
  assert.equal(
    (await service.feed(viewer, { focus: "unanswered" })).posts.some((p) => p.id === q.id),
    true,
  );
});
test("hidden, blocked, deleted and departed answers stop resolving on detail and unresolved feed", async () => {
  const q = await question(),
    a = await answer(q.id);
  await service.resolveQuestion(owner, q.id, { commentId: a.id, expectedUpdatedAt: q.updatedAt });
  await db.insert(safety.contentRestrictions).values({
    targetType: "comment",
    targetId: a.id,
    hidden: true,
    reason: "검토 중",
    updatedBy: owner,
  });
  assert.equal((await service.detail(q.id, viewer)).acceptedAnswer, null);
  assert.equal((await service.feed(viewer, { focus: "unanswered" })).posts[0]?.id, q.id);
  await db.delete(safety.contentRestrictions).where(eq(safety.contentRestrictions.targetId, a.id));
  await db
    .insert(safety.memberBlocks)
    .values({ blockerId: viewer, blockedId: writer, displayLabel: "차단한 답변 작성자" });
  assert.equal((await service.getPost(q.id, viewer)).acceptedAnswerId, null);
  assert.equal((await service.getPost(q.id, owner)).acceptedAnswerId, a.id);
  await db.insert(safety.memberSafety).values({ userId: writer, status: "closed" });
  assert.equal((await service.getPost(q.id, owner)).acceptedAnswerId, null);
  await db.delete(safety.memberSafety).where(eq(safety.memberSafety.userId, writer));
  await service.changeComment(writer, a.id, true);
  assert.equal((await service.detail(q.id, owner)).acceptedAnswer, null);
});
test("accepted answer is returned outside the first root comment page and reflects edits", async () => {
  const q = await question();
  const root = await answer(q.id);
  const reply = (
    await service.createComment(writer, {
      postId: q.id,
      parentId: root.id,
      bodyMarkdown: "깊은 답변",
    })
  ).comment;
  await service.resolveQuestion(owner, q.id, {
    commentId: reply.id,
    expectedUpdatedAt: q.updatedAt,
  });
  const detail = await service.detail(q.id, viewer);
  assert.equal(
    detail.comments.some((c) => c.id === reply.id),
    false,
  );
  assert.equal(detail.acceptedAnswer?.id, reply.id);
  await service.changeComment(writer, { commentId: reply.id, bodyMarkdown: "정정된 답변" });
  assert.equal((await service.detail(q.id, viewer)).acceptedAnswer?.body, "정정된 답변");
});
test("DB rejects cross-question/self/non-author resolutions and exposes no Data API grants", async () => {
  const q = await question(),
    other = await question(),
    own = await answer(q.id, owner),
    foreign = await answer(other.id),
    a = await answer(q.id);
  for (const [commentId, resolvedBy] of [
    [own.id, owner],
    [foreign.id, owner],
    [a.id, writer],
  ])
    await assert.rejects(
      db
        .insert(base.questionResolutions)
        .values({ postId: q.id, commentId: commentId!, resolvedBy: resolvedBy! }),
    );
  const { rows } = await pg.query<{ allowed: boolean }>(
    "select has_table_privilege('anon','sliper.question_resolutions','SELECT') as allowed",
  );
  assert.equal(rows[0]?.allowed, false);
});
test("legacy edits preserve new settings while changing question type clears its accepted answer", async () => {
  const q = await question({
      spoiler: true,
      spoilerTitle: "결말에 관한 질문",
      spoilerSummary: "시청 후 함께 이야기해요",
    }),
    a = await answer(q.id);
  const accepted = await service.resolveQuestion(owner, q.id, {
    commentId: a.id,
    expectedUpdatedAt: q.updatedAt,
  });
  const edited = await service.updatePost(owner, {
    ...input(),
    postId: q.id,
    expectedUpdatedAt: accepted.post.updatedAt,
  });
  assert.equal(edited.discussionType, "question");
  assert.equal(edited.spoiler, true);
  assert.equal(edited.spoilerTitle, "결말에 관한 질문");
  assert.equal(edited.acceptedAnswerId, a.id);
  const tip = await service.updatePost(owner, {
    ...input({ discussionType: "tip" }),
    postId: q.id,
    expectedUpdatedAt: edited.updatedAt,
  });
  assert.equal(tip.acceptedAnswerId, null);
  assert.equal((await db.select().from(base.questionResolutions)).length, 0);
});
test("interest feed uses explicit subscriptions without anonymous-host attribution or auto subscription", async () => {
  const publicPost = await service.createPost(owner, input());
  const anon = await service.createPost(owner, input({ isAnonymous: true }));
  await service.createPost(writer, input({ categorySlug: "travel" }));
  assert.equal((await service.feed(null, { focus: "interests" })).interestFeed, "login");
  assert.equal((await service.feed(viewer, { focus: "interests" })).interestFeed, "setup");
  assert.equal((await db.select().from(engagement.categorySubscriptions)).length, 0);
  await db.insert(engagement.hostSubscriptions).values({ userId: viewer, hostId: owner });
  const followed = await service.feed(viewer, { focus: "interests", page: 1, limit: 20 });
  assert.equal(followed.interestFeed, "personalized");
  assert.deepEqual(
    followed.posts.map((p) => p.id),
    [publicPost.id],
  );
  await db
    .insert(engagement.categorySubscriptions)
    .values({ userId: viewer, categorySlug: "party" });
  const categories = await service.feed(viewer, { focus: "interests" });
  assert.equal(categories.posts.length, 2);
  assert.equal(categories.posts.find((p) => p.id === anon.id)?.author, "익명");
  await db
    .insert(safety.memberBlocks)
    .values({ blockerId: viewer, blockedId: owner, displayLabel: "차단한 글 작성자" });
  assert.equal((await service.feed(viewer, { focus: "interests" })).posts.length, 0);
});
test("spoiler lists, search keywords, share metadata and local reconciliation never reveal body, title, tags or images", async () => {
  const p = await question({
    title: "범인은비밀인물",
    bodyMarkdown: "정답암호는은행나무",
    tags: ["비밀태그"],
    spoiler: true,
    spoilerTitle: "마지막 회 이야기",
    spoilerSummary: "함께 시청한 분들의 의견이 궁금해요",
  });
  await db.insert(base.mediaAssets).values({
    id: randomUUID(),
    uploaderId: owner,
    postId: p.id,
    objectKey: randomUUID() + ".webp",
    contentType: "image/webp",
    byteSize: 100,
    status: "ready",
  });
  const feed = await service.feed(viewer, {});
  const item = feed.posts[0]!;
  assert.equal(item.title, "마지막 회 이야기");
  assert.equal(item.body, "");
  assert.deepEqual(item.images, []);
  assert.deepEqual(item.tags, []);
  assert.equal(item.image, undefined);
  assert.equal((await service.feed(viewer, { search: "정답암호" })).posts.length, 0);
  assert.equal((await service.feed(viewer, { tag: "비밀태그" })).posts.length, 0);
  assert.equal((await searchService(connection).search(viewer, { q: "정답암호" })).total, 0);
  assert.equal(
    (await searchService(connection).search(viewer, { q: "마지막 회" })).items[0]?.title,
    "마지막 회 이야기",
  );
  assert.equal((await readPublicPostShare(connection, p.id)).title, "마지막 회 이야기");
  const full = await service.getPost(p.id, viewer);
  assert.equal(full.body, "정답암호는은행나무");
  assert.equal(previewPost(full).image, undefined);
  const reconciled = reconcilePosts([item], new Map([[p.id, { version: 1, post: full }]]));
  assert.equal(reconciled[0]?.body, "");
});
test("inbox and delivery redact previously queued text after a post becomes a spoiler", async () => {
  const p = await question();
  const a = await answer(p.id);
  await db.insert(engagement.inboxItems).values({
    recipientId: owner,
    dedupeKey: "comment:" + a.id,
    kind: "comments",
    postId: p.id,
    sourceId: a.id,
    title: "과거 원문 제목",
    body: "과거 원문 정답",
    url: "/posts/" + p.id,
  });
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey().toString("base64url");
  const [sub] = await db
    .insert(pushSubscriptions)
    .values({
      userId: owner,
      endpoint: "https://web.push.apple.com/fixture/" + randomUUID(),
      p256dh: publicKey,
      auth: randomBytes(16).toString("base64url"),
      vapidPublicKey: publicKey,
    })
    .returning();
  await db.insert(pushDeliveries).values({
    subscriptionId: sub!.id,
    recipientId: owner,
    dedupeKey: "comment:" + a.id,
    kind: "comment",
    postId: p.id,
    commentId: a.id,
    title: "과거 원문 제목",
    body: "과거 원문 정답",
    url: "/?post=" + p.id,
  });
  await service.updatePost(owner, {
    ...input({ spoiler: true, spoilerTitle: "안전한 제목" }),
    postId: p.id,
    expectedUpdatedAt: p.updatedAt,
  });
  const inbox = await engagementService(connection).inbox(owner);
  assert.equal(JSON.stringify(inbox).includes("과거 원문"), false);
  assert.equal(inbox.items.length, 1);
  const sent: string[] = [];
  const worker = pushDispatcher(
    connection,
    {
      subject: "mailto:test@example.com",
      publicKey,
      privateKey: ecdh.getPrivateKey().toString("base64url"),
    },
    async (_sub, delivery) => {
      sent.push(JSON.stringify({ title: delivery.title, body: delivery.body }));
    },
  );
  await worker.drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.includes("과거 원문"), false);
});
test("story focus and subtype survive page links while invalid options are ignored", () => {
  const url = communityLocationUrl(
    "https://sliper.example/stories",
    { kind: "이야기", discussionType: "question", focus: "unanswered" },
    3,
  );
  const parsed = communityLocation(new URL(url, "https://sliper.example").searchParams, true);
  assert.equal(parsed.focus, "unanswered");
  assert.equal(parsed.discussionType, "question");
  assert.equal(parsed.page, 3);
  assert.equal(
    communityLocation(new URLSearchParams("focus=bad&discussionType=bad"), true).discussionType,
    undefined,
  );
});

test("24h question answer rate excludes immature, self, hidden, staff and sample activity", async () => {
  const { analyticsService } = await import("../src/server/analytics-service");
  await db.insert(safety.staffRoles).values({ userId: viewer, role: "admin" });
  const now = new Date(),
    at = new Date(now.getTime() - 3 * 86400000);
  const make = async (extra: Partial<typeof base.posts.$inferInsert> = {}) => {
    const [row] = await db
      .insert(base.posts)
      .values({
        authorId: owner,
        categorySlug: "party",
        kind: "이야기",
        discussionType: "question",
        title: "질문 지표 검증",
        bodyMarkdown: "질문 본문",
        createdAt: at,
        ...extra,
      })
      .returning();
    return row!;
  };
  const answered = await make(),
    self = await make(),
    late = await make(),
    hidden = await make(),
    staff = await make();
  await make({ createdAt: new Date(now.getTime() - 3600000) });
  await make({ sample: true });
  const add = async (postId: string, authorId: string, hours: number) => {
    const [row] = await db
      .insert(base.comments)
      .values({
        postId,
        authorId,
        bodyMarkdown: "공개 답변",
        createdAt: new Date(at.getTime() + hours * 3600000),
      })
      .returning();
    return row!;
  };
  await add(answered.id, writer, 24);
  await add(self.id, owner, 1);
  await add(late.id, writer, 25);
  await add(staff.id, viewer, 1);
  const removed = await add(hidden.id, writer, 1);
  await db
    .insert(safety.contentRestrictions)
    .values({ targetType: "comment", targetId: removed.id, reason: "검토", hidden: true });
  const metrics = await analyticsService(connection).summary(viewer, { days: 7 }, now);
  assert.equal(metrics.counts.question_denominator, 5);
  assert.equal(metrics.counts.answered_in_24h, 1);
});
