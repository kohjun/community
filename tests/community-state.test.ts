import assert from "node:assert/strict";
import test from "node:test";
import type { CommunityComment, CommunityDetail, CommunityPost } from "../src/domain/community";
import type { NotificationItem } from "../src/domain/contracts";
import {
  applyCommentMutation,
  applyReadReceipt,
  mergeComments,
  reconcilePosts,
  reconcileDetail,
  matchesPostQuery,
} from "../src/lib/community-state";
import { decodeCursor, encodeCursor, pageScope } from "../src/server/pagination";

function comment(id: string, overrides: Partial<CommunityComment> = {}): CommunityComment {
  return {
    id,
    postId: "post",
    parentId: null,
    author: "익명",
    anonymous: true,
    body: "댓글",
    time: "오늘",
    createdAt: "2026-01-01T00:00:00.000001Z",
    replyCount: 0,
    isMine: true,
    isDeleted: false,
    ...overrides,
  };
}
const post: CommunityPost = {
  id: "post",
  category: "party",
  kind: "이야기",
  title: "글",
  body: "본문",
  excerpt: "본문",
  author: "익명",
  anonymous: true,
  time: "오늘",
  createdAt: "2026-01-01T00:00:00.000001Z",
  updatedAt: "2026-01-01T00:00:00.000001Z",
  likes: 0,
  views: 0,
  comments: 30,
  images: [],
  applicationUrl: null,
  eventFee: null,
  contactInfo: null,
  topic: null,
  tags: [],
  poll: null,
  featured: false,
  sample: false,
  isMine: true,
  isLiked: false,
  isBookmarked: false,
};

test("merging later comment pages keeps edited rows unique and orders by precise timestamps", () => {
  const early = comment("early"),
    later = comment("later", { createdAt: "2026-01-01T00:00:00.000002Z" });
  const merged = mergeComments([later, early], [{ ...early, body: "수정됨" }]);
  assert.deepEqual(
    merged.map((c) => c.id),
    ["early", "later"],
  );
  assert.equal(merged[0]!.body, "수정됨");
});

test("comment mutations preserve loaded pages and cursor and ignore responses for another post", () => {
  const current: CommunityDetail = {
    post,
    comments: Array.from({ length: 30 }, (_, i) => comment(String(i))),
    nextCommentCursor: "next-page",
  };
  const result = {
    post,
    comment: comment("reply", { parentId: "0" }),
    parent: comment("0", { replyCount: 1 }),
  };
  const next = applyCommentMutation(current, result)!;
  assert.equal(next.comments.length, 31);
  assert.equal(next.nextCommentCursor, "next-page");
  assert.equal(next.comments.find((c) => c.id === "0")!.replyCount, 1);
  assert.equal(
    applyCommentMutation(current, { ...result, post: { ...post, id: "other" } }),
    current,
  );
});

test("read receipts preserve older loaded pages and do not mark newer arrivals as read", () => {
  const notification = (id: string, createdAt: string): NotificationItem => ({
    id,
    createdAt,
    postId: "post",
    commentId: "comment",
    kind: "post_comment",
    message: "댓글",
    readAt: null,
  });
  const items = [
    notification("old", "2026-01-01T00:00:00.122999Z"),
    notification("new", "2026-01-01T00:00:00.123001Z"),
  ];
  const next = applyReadReceipt(items, {
    id: null,
    readAt: "2026-01-01T00:00:00.123000Z",
    unreadCount: 1,
  });
  assert.ok(next[0]!.readAt);
  assert.equal(next[1]!.readAt, null);
  assert.equal(next.length, 2);
});

test("cursor round trips keep microseconds, bind scope, and reject invalid dates and oversized payloads", () => {
  const scope = pageScope(["feed", "latest"]),
    row = { id: "10000000-0000-4000-8000-000000000001", createdAt: "2026-01-01T00:00:00.123456Z" };
  const value = encodeCursor(scope, row);
  assert.equal(decodeCursor(value, scope)!.at, row.createdAt);
  assert.throws(() => decodeCursor(value, pageScope(["feed", "popular"])));
  assert.throws(() => decodeCursor("x".repeat(1025), scope));
  const malformed = Buffer.from(
    JSON.stringify({ v: 1, scope, at: "2026-02-30T00:00:00.123456Z", id: row.id }),
  ).toString("base64url");
  assert.throws(() => decodeCursor(malformed, scope));
});

test("late feed responses preserve newer reactions and omit deletion tombstones", () => {
  const newer = { ...post, likes: 1, isLiked: true };
  const removed = { ...post, id: "removed" };
  const changes = new Map([
    [post.id, { version: 2, post: newer }],
    [removed.id, { version: 3, post: null }],
  ]);
  const next = reconcilePosts([post, removed], changes);
  assert.deepEqual(
    next.map((item) => item.id),
    [post.id],
  );
  assert.equal(next[0]!.likes, 1);
  assert.equal(next[0]!.isLiked, true);
});

test("local writes remove rows that no longer belong to the active bookmark or topic filter", () => {
  const bookmarked = {
    ...post,
    isBookmarked: true,
    category: "knowledge" as const,
    topic: "규칙",
    tags: ["팀 미션"],
  };
  assert.equal(
    matchesPostQuery(bookmarked, {
      view: "bookmarks",
      category: "knowledge",
      topic: "규칙",
      tag: "팀 미션",
    }),
    true,
  );
  assert.equal(matchesPostQuery({ ...bookmarked, kind: "후기" }, { kind: "이야기" }), true);
  const changes = new Map([
    [post.id, { version: 1, post: { ...bookmarked, isBookmarked: false } }],
  ]);
  assert.deepEqual(reconcilePosts([bookmarked], changes, { view: "bookmarks" }), []);
  assert.deepEqual(reconcilePosts([bookmarked], new Map(), { topic: "벌칙" }), []);
  assert.equal(matchesPostQuery(post, { search: "없는 검색어" }), false);
});

test("late detail reads retain a saved reaction and newly written, edited or deleted comments", () => {
  const original = comment("original"),
    removed = comment("removed"),
    reply = comment("reply", { parentId: original.id });
  const incoming: CommunityDetail = {
    post,
    comments: [original, removed],
    nextCommentCursor: "page-two",
  };
  const newer = { ...post, likes: 1, isLiked: true, comments: 2 };
  const posts = new Map([[post.id, { version: 1, post: newer }]]);
  const comments = new Map([
    [
      original.id,
      { version: 1, comment: { ...original, body: "새로 수정한 댓글", replyCount: 1 } },
    ],
    [
      removed.id,
      {
        version: 2,
        comment: { ...removed, body: "삭제된 댓글입니다.", isMine: false, isDeleted: true },
      },
    ],
    [reply.id, { version: 3, comment: reply }],
    ["other", { version: 4, comment: comment("other", { postId: "another-post" }) }],
  ]);
  const actual = reconcileDetail(incoming, posts, comments)!;
  assert.equal(actual.post.likes, 1);
  assert.equal(actual.post.isLiked, true);
  assert.equal(actual.comments.find((item) => item.id === original.id)!.body, "새로 수정한 댓글");
  assert.equal(actual.comments.find((item) => item.id === original.id)!.replyCount, 1);
  assert.equal(actual.comments.find((item) => item.id === removed.id)!.isDeleted, true);
  assert.equal(
    actual.comments.some((item) => item.id === reply.id),
    true,
  );
  assert.equal(actual.comments.length, 3);
  assert.equal(actual.nextCommentCursor, "page-two");
  assert.equal(
    reconcileDetail(incoming, new Map([[post.id, { version: 5, post: null }]]), comments),
    null,
  );
});
