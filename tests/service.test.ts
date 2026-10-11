import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { categories, mediaAssets } from "../src/db/schema";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { hashVisitor } from "../src/domain/visitor";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";
import { kstActivityClock } from "../src/server/activity";
import { sql } from "drizzle-orm";

const pg = new PGlite(),
  db = drizzle(pg, { schema });
const service = communityService(db as unknown as Database);
let owner: string, other: string;
const input = {
  categorySlug: "party",
  kind: "모집",
  applicationUrl: "https://example.com/apply",
  title: "주말 파티",
  bodyMarkdown: "## 함께 놀아요",
  isAnonymous: true,
  imageAssetIds: [],
};
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
async function editPost(actor: string | null, value: { postId: string } & Record<string, unknown>) {
  const revision = (await service.getPost(value.postId, actor)).updatedAt;
  return service.updatePost(actor, { ...value, expectedUpdatedAt: revision });
}
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("비공개소유자");
  other = await member("다른작성자");
});
after(() => pg.close());

test("post CRUD requires the owner, preserves anonymous privacy, and hides deleted content", async () => {
  await assert.rejects(service.createPost(null, input), code("UNAUTHENTICATED"));
  const post = await service.createPost(owner, input);
  assert.equal(post.author, "익명");
  assert.equal(post.isMine, true);
  const publicPost = await service.getPost(post.id, other);
  assert.equal(publicPost.isMine, false);
  for (const privateValue of [owner, "비공개소유자", "authorId"])
    assert.equal(JSON.stringify(publicPost).includes(privateValue), false);
  await assert.rejects(editPost(other, { ...input, postId: post.id }), code("FORBIDDEN"));
  await assert.rejects(service.deletePost(other, post.id), code("FORBIDDEN"));
  const updated = await editPost(owner, {
    ...input,
    postId: post.id,
    title: "수정한 파티",
    kind: "후기",
    applicationUrl: null,
  });
  assert.equal(updated.title, "수정한 파티");
  assert.equal(updated.kind, "후기");
  await service.deletePost(owner, post.id);
  await assert.rejects(service.detail(post.id, owner), code("NOT_FOUND"));
  assert.equal((await service.feed(owner)).posts.length, 0);
});

test("comment replies generate only eligible notifications and deletion preserves descendants", async () => {
  const post = await service.createPost(owner, input);
  let detail = await service.createComment(other, {
    postId: post.id,
    bodyMarkdown: "익명 댓글",
    isAnonymous: true,
  });
  const parent = detail.comment;
  assert.equal((await service.inbox(owner)).items.length, 1);
  detail = await service.createComment(owner, {
    postId: post.id,
    parentId: parent.id,
    bodyMarkdown: "답글",
    isAnonymous: true,
  });
  assert.equal((await service.inbox(other)).items.length, 1);
  await assert.rejects(
    service.changeComment(owner, { commentId: parent.id, bodyMarkdown: "탈취" }),
    code("FORBIDDEN"),
  );
  await service.changeComment(other, { commentId: parent.id, bodyMarkdown: "수정된 댓글" });
  detail = await service.changeComment(other, parent.id, true);
  assert.equal((await service.commentPage(post.id, owner)).items.length, 1);
  assert.equal(detail.comment.body, "삭제된 댓글입니다.");
  assert.equal(detail.comment.author, "삭제된 댓글");
  assert.equal(
    (await service.commentPage(post.id, owner, { parentId: parent.id })).items[0]!.parentId,
    parent.id,
  );
  assert.equal(detail.post.comments, 1);
  await assert.rejects(
    service.createComment(owner, {
      postId: post.id,
      parentId: parent.id,
      bodyMarkdown: "삭제 댓글에 답글",
    }),
    code("NOT_FOUND"),
  );
});

test("reply notification deduplication, recipient scoping and read state are transactional", async () => {
  const post = await service.createPost(owner, input);
  const own = await service.createComment(owner, { postId: post.id, bodyMarkdown: "내 댓글" });
  assert.equal((await service.inbox(owner)).items.length, 0);
  await service.createComment(other, {
    postId: post.id,
    parentId: own.comment.id,
    bodyMarkdown: "다른 작성자의 답글",
  });
  const inbox = await service.inbox(owner);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0]!.kind, "comment_reply");
  await service.markRead(other, inbox.items[0]!.id);
  assert.equal((await service.inbox(owner)).items[0]!.readAt, null);
  await service.markRead(owner);
  assert.ok((await service.inbox(owner)).items[0]!.readAt);
  await service.deletePost(owner, post.id);
  assert.equal((await service.inbox(owner)).items.length, 0);
});

test("reactions are idempotent, private bookmark lists are scoped, and views deduplicate", async () => {
  const post = await service.createPost(owner, input);
  await service.react(other, post.id, "like", true);
  await service.react(other, post.id, "like", true);
  await service.react(other, post.id, "bookmark", true);
  assert.equal((await service.getPost(post.id, other)).likes, 1);
  assert.equal((await service.feed(other, { view: "bookmarks" })).posts.length, 1);
  assert.equal((await service.feed(owner, { view: "bookmarks" })).posts.length, 0);
  const hash = hashVisitor(randomUUID(), post.id, "test-visitor-secret-of-at-least-32-characters");
  await service.recordView(post.id, hash, null);
  await service.recordView(post.id, hash, null);
  assert.equal((await service.getPost(post.id, null)).views, 1);
  await service.react(other, post.id, "like", false);
  await service.react(other, post.id, "like", false);
  assert.equal((await service.getPost(post.id, other)).likes, 0);
});

test("media attachment validates ownership and failed writes roll back atomically", async () => {
  const id = randomUUID();
  await db.insert(mediaAssets).values({
    id,
    uploaderId: other,
    objectKey: `${id}.png`,
    byteSize: 100,
    contentType: "image/png",
    status: "ready",
  });
  await assert.rejects(
    service.createPost(owner, { ...input, imageAssetIds: [id] }),
    code("FORBIDDEN"),
  );
  assert.equal((await service.feed(owner)).posts.length, 0);
  const post = await service.createPost(other, { ...input, imageAssetIds: [id] });
  assert.equal(post.images[0]?.src, `/api/media/${id}`);
  await assert.rejects(
    service.createPost(other, { ...input, imageAssetIds: [id] }),
    code("FORBIDDEN"),
  );
  const detached = await editPost(other, {
    ...input,
    postId: post.id,
    imageAssetIds: [],
  });
  assert.equal(detached.images.length, 0);
});

test("search, categories, types, sorting and pagination read authoritative database rows", async () => {
  for (let i = 0; i < 5; i++) await service.createPost(owner, { ...input, title: `파티 ${i}` });
  const first = await service.feed(owner, { limit: 2 });
  const second = await service.feed(owner, { limit: 2, cursor: first.nextCursor! });
  assert.equal(new Set([...first.posts, ...second.posts].map((p) => p.id)).size, 4);
  assert.equal((await service.feed(owner, { search: "파티 4" })).posts.length, 1);
  assert.equal((await service.feed(owner, { search: "%" })).posts.length, 0);
  assert.equal((await service.feed(owner, { category: "music" })).posts.length, 0);
  assert.equal((await service.feed(owner, { kind: "후기" })).posts.length, 0);
  await service.react(other, second.posts[0]!.id, "like", true);
  assert.equal((await service.feed(owner, { sort: "popular" })).posts[0]!.id, second.posts[0]!.id);
});

test("deleted posts reject comments, reactions and view mutations; cross-post replies fail", async () => {
  const a = await service.createPost(owner, input),
    b = await service.createPost(other, input);
  const parent = (await service.createComment(owner, { postId: a.id, bodyMarkdown: "댓글" }))
    .comment;
  await assert.rejects(
    service.createComment(other, { postId: b.id, parentId: parent.id, bodyMarkdown: "다른 글" }),
    code("NOT_FOUND"),
  );
  await service.deletePost(owner, a.id);
  await assert.rejects(
    service.createComment(other, { postId: a.id, bodyMarkdown: "삭제글" }),
    code("NOT_FOUND"),
  );
  await assert.rejects(service.react(other, a.id, "like", true), code("NOT_FOUND"));
  await assert.rejects(service.recordView(a.id, "a".repeat(64), null), code("NOT_FOUND"));
});

test("recruitment links persist, can be replaced by the author, and are cleared when changing post type", async () => {
  const post = await service.createPost(owner, input);
  assert.equal((await service.detail(post.id, null)).post.applicationUrl, input.applicationUrl);
  assert.equal(
    (await service.feed(null, { kind: "모집" })).posts[0]!.applicationUrl,
    input.applicationUrl,
  );
  const changed = await editPost(owner, {
    ...input,
    postId: post.id,
    applicationUrl: "https://example.org/another-form?id=1",
  });
  assert.equal(changed.applicationUrl, "https://example.org/another-form?id=1");
  await assert.rejects(
    editPost(other, {
      ...input,
      postId: post.id,
      applicationUrl: "https://example.net/wrong-owner",
    }),
    code("FORBIDDEN"),
  );
  const ordinary = await editPost(owner, {
    ...input,
    postId: post.id,
    kind: "후기",
    applicationUrl: null,
  });
  assert.equal(ordinary.applicationUrl, null);
  await assert.rejects(
    editPost(owner, { ...input, postId: post.id, applicationUrl: "javascript:alert(1)" }),
  );
  assert.equal((await service.getPost(post.id, owner)).kind, "후기");
});

test("feed cursors preserve microseconds and survive insertions and a deleted page anchor", async () => {
  for (let i = 0; i < 8; i++)
    await pg.query(
      "insert into sliper.posts (id,author_id,category_slug,title,body_markdown,created_at) values ($1,$2,'party','목록 경계','본문',$3)",
      [randomUUID(), owner, `2020-01-01T00:00:00.${i < 3 ? "123456" : "123455"}Z`],
    );
  const expected = (
    await pg.query<{ id: string }>("select id from sliper.posts order by created_at desc, id desc")
  ).rows.map((row) => row.id);
  const first = await service.feed(owner, { limit: 2 });
  assert.deepEqual(
    first.posts.map((p) => p.id),
    expected.slice(0, 2),
  );
  assert.match(first.posts[0]!.createdAt, /\.123456Z$/);
  await service.deletePost(owner, first.posts[1]!.id);
  const fresh = await service.createPost(owner, input);
  const rest: string[] = [];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await service.feed(owner, { limit: 2, cursor });
    rest.push(...page.posts.map((p) => p.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(rest, expected.slice(2));
  assert.equal(rest.includes(fresh.id), false);
});

test("feed cursors bind filters and sorting, paginate equal popularity, and reject malformed tokens", async () => {
  for (let i = 0; i < 5; i++) {
    const p = await service.createPost(owner, input);
    await service.react(other, p.id, "like", true);
  }
  const first = await service.feed(owner, { sort: "popular", limit: 2 });
  const second = await service.feed(owner, {
    sort: "popular",
    limit: 2,
    cursor: first.nextCursor!,
  });
  assert.equal(new Set([...first.posts, ...second.posts].map((p) => p.id)).size, 4);
  await assert.rejects(
    service.feed(owner, { sort: "latest", cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  await assert.rejects(
    service.feed(owner, { sort: "popular", category: "party", cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  await assert.rejects(
    service.feed(other, { sort: "popular", cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  await assert.rejects(service.feed(owner, { cursor: "not-valid-json" }), code("VALIDATION"));
  await assert.rejects(service.feed(owner, { limit: 999 }));
});

test("comments and replies page independently, including descendants of a deleted parent", async () => {
  const post = await service.createPost(owner, input);
  const roots = Array.from({ length: 25 }, () => ({
    id: randomUUID(),
    postId: post.id,
    authorId: owner,
    bodyMarkdown: "부모 댓글",
  }));
  await db.insert(schema.comments).values(roots);
  const parentId = roots[0]!.id;
  const children = Array.from({ length: 23 }, () => ({
    id: randomUUID(),
    postId: post.id,
    parentId,
    authorId: other,
    bodyMarkdown: "답글",
  }));
  await db.insert(schema.comments).values(children);
  await service.createComment(owner, {
    postId: post.id,
    parentId: children[0]!.id,
    bodyMarkdown: "깊은 답글",
  });
  const detail = await service.detail(post.id, owner);
  assert.equal(detail.comments.length, 20);
  assert.ok(detail.nextCommentCursor);
  assert.ok(detail.comments.every((c) => c.parentId === null));
  const remainder = await service.commentPage(post.id, owner, {
    cursor: detail.nextCommentCursor!,
  });
  assert.equal(remainder.items.length, 5);
  assert.equal(remainder.nextCursor, null);
  await service.changeComment(owner, parentId, true);
  const first = await service.commentPage(post.id, owner, { parentId, limit: 10 });
  const second = await service.commentPage(post.id, owner, {
    parentId,
    limit: 10,
    cursor: first.nextCursor!,
  });
  const third = await service.commentPage(post.id, owner, {
    parentId,
    limit: 10,
    cursor: second.nextCursor!,
  });
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((c) => c.id)).size,
    23,
  );
  assert.equal(third.nextCursor, null);
  assert.equal(
    (await service.commentPage(post.id, owner, { parentId: children[0]!.id })).items.length,
    1,
  );
  await assert.rejects(
    service.commentPage(post.id, owner, { cursor: first.nextCursor! }),
    code("VALIDATION"),
  );
  const secondPost = await service.createPost(owner, input);
  await assert.rejects(service.commentPage(secondPost.id, owner, { parentId }), code("NOT_FOUND"));
});

test("notifications beyond 100 remain reachable and unread count is independent of page size", async () => {
  const post = await service.createPost(owner, input);
  const rows = Array.from({ length: 105 }, () => ({
    id: randomUUID(),
    postId: post.id,
    authorId: other,
    bodyMarkdown: "알림 테스트",
  }));
  await db.insert(schema.comments).values(rows);
  await db.insert(schema.notifications).values(
    rows.map((c) => ({
      recipientId: owner,
      postId: post.id,
      commentId: c.id,
      kind: "post_comment" as const,
    })),
  );
  const first = await service.inbox(owner);
  assert.equal(first.items.length, 20);
  assert.equal(first.unreadCount, 105);
  const all = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await service.inbox(owner, { cursor });
    all.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.equal(new Set(all.map((n) => n.id)).size, 105);
  await assert.rejects(service.inbox(other, { cursor: first.nextCursor! }), code("VALIDATION"));
  assert.equal((await service.markRead(owner, first.items[0]!.id)).unreadCount, 104);
  assert.equal((await service.markRead(owner)).unreadCount, 0);
  assert.equal(
    (await service.inbox(owner, { cursor: first.nextCursor! })).items.every(
      (n) => n.readAt !== null,
    ),
    true,
  );
});

test("polls require an actor, validate options, aggregate anonymous votes and keep one vote per member", async () => {
  const pollInput = {
    ...input,
    kind: "투표",
    applicationUrl: null,
    poll: { question: "어떤 미션을 할까요?", options: ["블라인드 미션", "팀 레이스", "개인 추리"] },
  };
  const post = await service.createPost(owner, pollInput);
  assert.equal(post.poll?.total, 0);
  await assert.rejects(service.vote(null, post.id, { optionIndex: 0 }), code("UNAUTHENTICATED"));
  await assert.rejects(service.vote(other, post.id, { optionIndex: 3 }), code("VALIDATION"));
  await service.vote(owner, post.id, { optionIndex: 0 });
  const voted = await service.vote(other, post.id, { optionIndex: 2 });
  assert.equal(voted.poll?.total, 2);
  assert.equal(voted.poll?.selected, 2);
  const changed = await service.vote(other, post.id, { optionIndex: 0 });
  assert.equal(changed.poll?.total, 2);
  assert.equal(changed.poll?.options[0]?.votes, 2);
  const publicPost = await service.getPost(post.id, null);
  assert.equal(publicPost.poll?.selected, null);
  assert.equal(JSON.stringify(publicPost).includes(other), false);
  await assert.rejects(
    editPost(owner, {
      ...pollInput,
      postId: post.id,
      poll: { question: "변경된 질문", options: ["A", "B"] },
    }),
    code("CONFLICT"),
  );
  assert.equal(
    (await editPost(owner, { ...pollInput, postId: post.id, title: "본문 설명 수정" })).title,
    "본문 설명 수정",
  );
  await assert.rejects(
    pg.query("update sliper.posts set poll=$2 where id=$1", [
      post.id,
      JSON.stringify({ question: "바뀐 질문", options: ["A", "B"] }),
    ]),
  );
  await service.deletePost(owner, post.id);
  await assert.rejects(service.vote(other, post.id, { optionIndex: 1 }), code("NOT_FOUND"));
  const deleted = await pg.query<{ poll: unknown }>("select poll from sliper.posts where id=$1", [
    post.id,
  ]);
  assert.equal(deleted.rows[0]?.poll, null);
});
test("profile editing is private and activity rewards survive deletion with KST daily deduplication and caps", async () => {
  await assert.rejects(service.me(null), code("UNAUTHENTICATED"));
  await assert.rejects(service.updateProfile(other, { nickname: "좋은닉네임", points: 9999 }));
  const profile = await service.updateProfile(owner, {
    nickname: "플레이메이트",
    bio: "함께 만드는 미션",
    region: "서울",
    avatar: "game",
    interests: ["lab", "party"],
  });
  assert.equal(profile.nickname, "플레이메이트");
  assert.equal(profile.bio, "함께 만드는 미션");
  assert.equal(profile.interests[0], "lab");
  assert.equal((await service.me(other)).nickname, "다른작성자");
  assert.equal(JSON.stringify(profile).includes(owner), false);
  await service.visit(owner);
  await service.visit(owner);
  assert.equal((await service.me(owner)).points, 2);
  const post = await service.createPost(owner, { ...input, kind: "이야기", applicationUrl: null });
  await service.createComment(owner, { postId: post.id, bodyMarkdown: "첫 댓글" });
  assert.equal((await service.me(owner)).points, 9);
  for (let i = 0; i < 12; i++)
    await service.createComment(owner, { postId: post.id, bodyMarkdown: `추가 댓글 ${i}` });
  assert.equal((await service.me(owner)).points, 27);
  await service.deletePost(owner, post.id);
  assert.equal((await service.me(owner)).points, 27);
  assert.equal((await service.me(owner)).earned.posts, 1);
  await pg.query(
    "update sliper.activity_events set created_at = created_at - interval '1 day' where user_id=$1",
    [owner],
  );
  await pg.query(
    "update sliper.activity_events set source_key='visit:previous-day' where user_id=$1 and reason='visit'",
    [owner],
  );
  await service.visit(owner);
  assert.equal((await service.me(owner)).counts.visits, 2);
});
test("creative boards validate subtopics and support independent topic and tag filters", async () => {
  await assert.rejects(
    service.createPost(owner, {
      ...input,
      kind: "이야기",
      applicationUrl: null,
      categorySlug: "knowledge",
    }),
  );
  const post = await service.createPost(owner, {
    ...input,
    kind: "이야기",
    applicationUrl: null,
    categorySlug: "knowledge",
    topic: "미션",
    tags: ["런닝맨", "팀 미션"],
  });
  assert.equal(post.topic, "미션");
  assert.equal(
    (await service.feed(null, { category: "knowledge", topic: "미션", tag: "런닝맨" })).posts[0]
      ?.id,
    post.id,
  );
  assert.equal(
    (await service.feed(null, { category: "knowledge", topic: "벌칙" })).posts.length,
    0,
  );
  await assert.rejects(
    service.createPost(owner, {
      ...input,
      kind: "이야기",
      applicationUrl: null,
      categorySlug: "lab",
      topic: "벌칙",
    }),
  );
  await assert.rejects(
    service.createPost(owner, {
      ...input,
      kind: "투표",
      applicationUrl: null,
      poll: { question: "선택해요", options: ["동일", "동일"] },
    }),
  );
});

test("stale editor content cannot overwrite a newer saved post", async () => {
  const post = await service.createPost(owner, { ...input, kind: "이야기", applicationUrl: null });
  const first = {
    ...input,
    postId: post.id,
    kind: "이야기",
    applicationUrl: null,
    title: "먼저 저장한 최신 내용",
  };
  await service.updatePost(owner, { ...first, expectedUpdatedAt: post.updatedAt });
  await assert.rejects(
    service.updatePost(owner, {
      ...first,
      title: "이전 탭의 오래된 내용",
      expectedUpdatedAt: post.updatedAt,
    }),
    code("CONFLICT"),
  );
  assert.equal((await service.getPost(post.id, owner)).title, first.title);
  await assert.rejects(service.updatePost(owner, first));
});

test("post edit revisions preserve microseconds and content edits do not conflict with reactions", async () => {
  const [row] = await db
    .insert(schema.posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      title: "정밀 버전",
      bodyMarkdown: "본문",
      updatedAt: sql`'2026-01-01T00:00:00.123456Z'::timestamptz`,
    })
    .returning({ id: schema.posts.id });
  const post = await service.getPost(row!.id, owner);
  assert.equal(post.updatedAt, "2026-01-01T00:00:00.123456Z");
  await service.react(owner, post.id, "like", true);
  const saved = await service.updatePost(owner, {
    ...input,
    kind: "이야기",
    applicationUrl: null,
    postId: post.id,
    title: "정밀 수정",
    expectedUpdatedAt: post.updatedAt,
  });
  assert.equal(saved.title, "정밀 수정");
  assert.equal(saved.likes, 1);
});

test("KST reward windows stay 24 hours and switch at UTC 15 even in DST sessions", async () => {
  await pg.exec("set time zone 'America/New_York'");
  try {
    for (const [time, day, start, end] of [
      ["2026-03-08T12:00:00Z", "2026-03-08", "2026-03-07T15:00:00Z", "2026-03-08T15:00:00Z"],
      ["2026-11-01T12:00:00Z", "2026-11-01", "2026-10-31T15:00:00Z", "2026-11-01T15:00:00Z"],
      ["2026-12-31T15:00:00Z", "2027-01-01", "2026-12-31T15:00:00Z", "2027-01-01T15:00:00Z"],
    ]) {
      const clock = kstActivityClock(sql`${time}::timestamptz`);
      const [result] = await db
        .select({
          day: clock.day,
          hours: sql<number>`extract(epoch from (${clock.end}-${clock.start}))/3600`,
          valid: sql<boolean>`${clock.start}=${start}::timestamptz and ${clock.end}=${end}::timestamptz`,
        })
        .from(schema.profiles)
        .limit(1);
      assert.equal(result!.day, day);
      assert.equal(Number(result!.hours), 24);
      assert.equal(result!.valid, true);
    }
  } finally {
    await pg.exec("set time zone 'UTC'");
  }
});
