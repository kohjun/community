import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityPostRow } from "../src/components/community-post-row";
import { PostDetailContent } from "../src/components/post-detail-content";
import type { CommunityPost, CommunityComment } from "../src/domain/community";
import type { useCommunity } from "../src/lib/use-community";
const post: CommunityPost = {
  id: "4f513b14-dfdc-4b04-bf24-e75e171f77ec",
  category: "party",
  kind: "이야기",
  title: "새로운 게임 이야기",
  excerpt: "요약",
  body: "본문",
  author: "익명",
  anonymous: true,
  time: "방금",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  likes: 3,
  views: 8,
  comments: 2,
  images: [],
  applicationUrl: null,
  eventFee: null,
  contactInfo: null,
  topic: null,
  tags: ["파티"],
  poll: null,
  featured: false,
  sample: false,
  isMine: true,
  isLiked: true,
  isBookmarked: false,
};
const comments: CommunityComment[] = [
  {
    id: "a",
    postId: post.id,
    parentId: null,
    createdAt: post.createdAt,
    replyCount: 1,
    author: "참가자",
    anonymous: false,
    body: "첫 댓글",
    time: "방금",
    isMine: true,
    isDeleted: false,
  },
  {
    id: "b",
    postId: post.id,
    parentId: "a",
    createdAt: post.createdAt,
    replyCount: 0,
    author: "익명",
    anonymous: true,
    body: "첫 답글",
    time: "방금",
    isMine: false,
    isDeleted: false,
  },
];
function detailMarkup(overrides: Partial<CommunityPost> = {}, canWrite = true) {
  const store = {
    comments,
    busy: false,
    canWrite,
    bookmarked: [],
    replyCursors: {},
    loadingComments: false,
    nextCommentCursor: null,
  } as unknown as ReturnType<typeof useCommunity>;
  return renderToStaticMarkup(
    createElement(PostDetailContent, {
      post: { ...post, ...overrides },
      store,
      presentation: "page",
      onUnavailable: () => {},
    }),
  );
}
test("post rows expose actual detail links for title and excerpt while reaction controls remain buttons", () => {
  const noop = () => {};
  const markup = renderToStaticMarkup(
    createElement(CommunityPostRow, {
      post,
      busy: false,
      canWrite: true,
      onOpen: noop,
      onLike: noop,
      onSave: noop,
      onTag: noop,
    }),
  );
  assert.equal((markup.match(new RegExp('href="/posts/' + post.id + '"', "g")) ?? []).length, 2);
  assert.match(markup, /class="post-title-open"/);
  assert.match(markup, /aria-label="새로운 게임 이야기 좋아요"/);
  assert.match(markup, /<button[^>]*aria-pressed="true"/);
});
test("standalone detail preserves one heading, sharing, owner controls, comments and threaded replies", () => {
  const markup = detailMarkup();
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  assert.match(markup, /새로운 게임 이야기/);
  assert.match(markup, /글 수정/);
  assert.match(markup, /글 삭제/);
  assert.match(markup, /aria-label="글 공유하기"/);
  assert.match(markup, /좋아요 3/);
  assert.match(markup, /북마크/);
  assert.ok(markup.indexOf("첫 댓글") < markup.indexOf("첫 답글"));
  assert.match(markup, /margin-left:14px/);
  assert.match(markup, /댓글 수정/);
  assert.match(markup, /댓글 등록/);
});
test("readonly readers can share and follow the login link but cannot submit reactions or comments", () => {
  const markup = detailMarkup({ isMine: false }, false);
  assert.doesNotMatch(markup, />글 수정<|>글 삭제</);
  assert.match(markup, /href="\/login\?next=\/posts\//);
  assert.match(markup, /<textarea[^>]*disabled=""/);
  assert.match(markup, /aria-label="글 공유하기"/);
  assert.match(markup, /신고/);
});
test("recruitment and polling controls remain available on the shared standalone detail", () => {
  const recruit = detailMarkup({ kind: "모집", applicationUrl: "https://example.com/apply" });
  assert.match(recruit, /target="_blank" rel="noopener noreferrer"/);
  assert.match(recruit, /href="\/events\//);
  assert.match(recruit, /행사 관리/);
  const poll = detailMarkup({
    kind: "투표",
    poll: {
      question: "어떤 방식이 좋아요?",
      options: [
        { label: "두뇌 게임", votes: 1 },
        { label: "레이스", votes: 0 },
      ],
      total: 1,
      selected: null,
    },
  });
  assert.match(poll, /어떤 방식이 좋아요/);
  assert.match(poll, /두뇌 게임/);
});
