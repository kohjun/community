import assert from "node:assert/strict";
import test from "node:test";
import type { CommentRecord, NotificationRecord, PostRecord } from "../src/db/types";
import { CATEGORIES, CATEGORY_SLUGS } from "../src/domain/categories";
import {
  presentComment,
  presentNotification,
  presentPostDetail,
  presentPostSummary,
} from "../src/domain/presenters";
import {
  categorySlugSchema,
  createCommentSchema,
  createPostSchema,
  recordPostViewSchema,
  setPostReactionSchema,
  updateCommentSchema,
  updatePostSchema,
} from "../src/domain/validation";
import { hashVisitor, koreaDate } from "../src/domain/visitor";

const AUTHOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUBLIC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_POST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COMMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_USER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";
const DATE = new Date("2026-09-29T12:00:00.000Z");
const SECRET = "sliper-test-secret-only-32-characters-minimum";
const profile = { id: AUTHOR_ID, publicId: PUBLIC_ID, nickname: "비공개 작성자 닉네임" };
const context = {
  profile,
  viewerId: AUTHOR_ID,
  stats: { likeCount: 2, bookmarkCount: 1, viewCount: 10, commentCount: 3 },
  isLiked: false,
  isBookmarked: true,
};

function post(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: POST_ID,
    categorySlug: "party",
    authorId: AUTHOR_ID,
    isAnonymous: true,
    title: "주말 예능 파티",
    bodyMarkdown: "함께할 사람을 찾아요.",
    bodyDocument: null,
    status: "published",
    createdAt: DATE,
    updatedAt: DATE,
    deletedAt: null,
    kind: "이야기",
    discussionType: null,
    spoiler: false,
    spoilerTitle: null,
    spoilerSummary: null,
    featured: false,
    sample: false,
    location: null,
    eventDate: null,
    applicationUrl: null,
    eventFee: null,
    contactInfo: null,
    topic: null,
    tags: [],
    poll: null,
    ...overrides,
  };
}

function comment(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: COMMENT_ID,
    postId: POST_ID,
    parentId: null,
    authorId: AUTHOR_ID,
    isAnonymous: true,
    bodyMarkdown: "저도 참여할게요.",
    status: "published",
    createdAt: DATE,
    updatedAt: DATE,
    deletedAt: null,
    ...overrides,
  };
}

function notification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: NOTIFICATION_ID,
    recipientId: AUTHOR_ID,
    postId: POST_ID,
    commentId: COMMENT_ID,
    kind: "comment_reply",
    readAt: null,
    createdAt: DATE,
    ...overrides,
  };
}

const validPost = { categorySlug: "party", title: "예능 파티", bodyMarkdown: "함께 놀아요." };
const validComment = { postId: POST_ID, bodyMarkdown: "참여할게요." };

test("anonymous post DTO exposes ownership to its author without exposing identity or extra database fields", () => {
  const source = {
    ...post(),
    internalAuditNote: "private-audit-value",
    email: "private@example.invalid",
  };
  const dto = presentPostSummary(source, {
    ...context,
    stats: { ...context.stats, privateCountSource: "private-source" },
  } as typeof context);
  const json = JSON.stringify(dto);
  assert.deepEqual(dto.author, { kind: "anonymous", displayName: "익명" });
  assert.equal(dto.isMine, true);
  for (const secret of [
    AUTHOR_ID,
    PUBLIC_ID,
    profile.nickname,
    "authorId",
    "publicId",
    "nickname",
    "internalAuditNote",
    "private-audit-value",
    "private@example.invalid",
    "private-source",
  ]) {
    assert.equal(json.includes(secret), false, `Public DTO leaked ${secret}`);
  }
  assert.equal(presentPostSummary(source, { ...context, viewerId: OTHER_USER_ID }).isMine, false);
  assert.equal(presentPostSummary(source, { ...context, viewerId: null }).isMine, false);
});

test("post detail projects image fields and substitutes the public media route", () => {
  const asset = {
    id: PUBLIC_ID,
    src: `https://storage.invalid/${AUTHOR_ID}/private-name.png`,
    contentType: "image/png" as const,
    sortOrder: 0,
    uploaderId: AUTHOR_ID,
    objectKey: "private-object-name",
  };
  const dto = presentPostDetail(post(), context, [asset]);
  assert.deepEqual(dto.images, [
    { id: PUBLIC_ID, src: `/api/media/${PUBLIC_ID}`, contentType: "image/png", sortOrder: 0 },
  ]);
  assert.equal(JSON.stringify(dto).includes(AUTHOR_ID), false);
  assert.equal(JSON.stringify(dto).includes("private-object-name"), false);
  assert.equal(dto.bodyMarkdown, post().bodyMarkdown);
});

test("member posts expose only the public identity and never a mismatched joined profile", () => {
  const dto = presentPostSummary(post({ isAnonymous: false }), context);
  assert.deepEqual(dto.author, {
    kind: "member",
    displayName: profile.nickname,
    publicProfileId: PUBLIC_ID,
  });
  assert.equal(JSON.stringify(dto).includes(AUTHOR_ID), false);
  const mismatched = presentPostSummary(post({ isAnonymous: false }), {
    ...context,
    profile: { ...profile, id: OTHER_USER_ID },
  });
  assert.deepEqual(mismatched.author, { kind: "deleted", displayName: "탈퇴한 회원" });
  assert.equal(JSON.stringify(mismatched).includes(profile.nickname), false);
});

test("withdrawn authors lose their public identity while anonymous posts remain anonymous", () => {
  const dto = presentPostSummary(post({ authorId: null, isAnonymous: false }), context);
  assert.deepEqual(dto.author, { kind: "deleted", displayName: "탈퇴한 회원" });
  assert.equal(dto.isMine, false);
  for (const value of [AUTHOR_ID, PUBLIC_ID, profile.nickname])
    assert.equal(JSON.stringify(dto).includes(value), false);
  const anonymous = presentPostSummary(post({ authorId: null }), { ...context, profile: null });
  assert.deepEqual(anonymous.author, { kind: "anonymous", displayName: "익명" });
});

test("deleted posts cannot be presented as summaries or details", () => {
  const deleted = post({ status: "deleted", deletedAt: DATE });
  assert.throws(() => presentPostSummary(deleted, context), /Deleted posts/);
  assert.throws(() => presentPostDetail(deleted, context, []), /Deleted posts/);
});

test("deleted comments retain their thread position but hide body, author, and ownership", () => {
  const source = {
    ...comment({ parentId: OTHER_POST_ID, status: "deleted", deletedAt: DATE }),
    internalModerationNote: "private-moderation-value",
  };
  const dto = presentComment(source, profile, AUTHOR_ID);
  assert.equal(dto.id, COMMENT_ID);
  assert.equal(dto.parentId, OTHER_POST_ID);
  assert.equal(dto.postId, POST_ID);
  assert.equal(dto.isDeleted, true);
  assert.equal(dto.author, null);
  assert.equal(dto.bodyMarkdown, null);
  assert.equal(dto.isMine, false);
  for (const value of [
    AUTHOR_ID,
    PUBLIC_ID,
    profile.nickname,
    source.bodyMarkdown,
    "private-moderation-value",
  ])
    assert.equal(JSON.stringify(dto).includes(value), false);
});

test("anonymous and withdrawn comment authors use the same identity privacy rules as posts", () => {
  const anonymous = presentComment(comment(), profile, AUTHOR_ID);
  assert.deepEqual(anonymous.author, { kind: "anonymous", displayName: "익명" });
  assert.equal(anonymous.isMine, true);
  assert.equal(JSON.stringify(anonymous).includes(AUTHOR_ID), false);
  const withdrawn = presentComment(
    comment({ authorId: null, isAnonymous: false }),
    profile,
    AUTHOR_ID,
  );
  assert.deepEqual(withdrawn.author, { kind: "deleted", displayName: "탈퇴한 회원" });
  assert.equal(withdrawn.isMine, false);
});

test("notification projection rejects a different recipient and never leaks actor or recipient metadata", () => {
  const source = {
    ...notification(),
    actorId: OTHER_USER_ID,
    actorNickname: profile.nickname,
    privateAudit: "private-notification-value",
  };
  assert.throws(() => presentNotification(source, OTHER_USER_ID), /another member/);
  const dto = presentNotification(source, AUTHOR_ID);
  assert.equal(dto.message, "내 댓글에 답글이 달렸어요.");
  assert.equal(dto.readAt, null);
  for (const value of [
    AUTHOR_ID,
    OTHER_USER_ID,
    profile.nickname,
    "actor",
    "recipient",
    "private-notification-value",
  ])
    assert.equal(JSON.stringify(dto).includes(value), false);
  const read = presentNotification(notification({ kind: "post_comment", readAt: DATE }), AUTHOR_ID);
  assert.equal(read.message, "내 글에 새 댓글이 달렸어요.");
  assert.equal(read.readAt, DATE.toISOString());
});

test("write inputs reject forged author IDs and server-owned fields", () => {
  for (const [schema, input] of [
    [createPostSchema, validPost],
    [
      updatePostSchema,
      { ...validPost, postId: POST_ID, expectedUpdatedAt: "2026-01-01T00:00:00.123456Z" },
    ],
    [createCommentSchema, validComment],
    [updateCommentSchema, { commentId: COMMENT_ID, bodyMarkdown: "수정 댓글" }],
    [setPostReactionSchema, { postId: POST_ID, active: true }],
  ] as const) {
    assert.equal(schema.safeParse(input).success, true);
    for (const forged of [
      { authorId: OTHER_USER_ID },
      { userId: OTHER_USER_ID },
      { likeCount: 999 },
    ]) {
      assert.equal(schema.safeParse({ ...input, ...forged }).success, false);
    }
  }
});

test("view input accepts only a post ID and rejects forged visitor hashes and dates", () => {
  assert.equal(recordPostViewSchema.safeParse({ postId: POST_ID }).success, true);
  for (const forged of [
    { visitorHash: "a".repeat(64) },
    { viewedOn: "2030-01-01" },
    { authorId: AUTHOR_ID },
    { visitorId: AUTHOR_ID },
  ]) {
    assert.equal(recordPostViewSchema.safeParse({ postId: POST_ID, ...forged }).success, false);
  }
});

test("the nine original categories and three creative boards are accepted", () => {
  assert.deepEqual(
    CATEGORIES.map(({ name }) => name),
    [
      "여행",
      "연애",
      "레이스",
      "심리추리",
      "서바이벌",
      "음악",
      "스포츠",
      "요리",
      "파티",
      "지식",
      "콘텐츠 연구소",
      "함께 만드는 크루",
    ],
  );
  assert.equal(CATEGORY_SLUGS.length, 12);
  assert.equal(new Set(CATEGORY_SLUGS).size, 12);
  for (const categorySlug of CATEGORY_SLUGS)
    assert.equal(categorySlugSchema.safeParse(categorySlug).success, true);
  for (const categorySlug of CATEGORY_SLUGS.slice(0, 9))
    assert.equal(createPostSchema.safeParse({ ...validPost, categorySlug }).success, true);
  assert.equal(categorySlugSchema.safeParse("free-board").success, false);
  assert.equal(categorySlugSchema.safeParse("여행").success, false);
});

test("post and comment body boundaries reject empty, whitespace-only, and oversized content", () => {
  assert.equal(
    createPostSchema.safeParse({ ...validPost, bodyMarkdown: "a".repeat(30_000) }).success,
    true,
  );
  assert.equal(
    createPostSchema.safeParse({ ...validPost, bodyMarkdown: "a".repeat(30_001) }).success,
    false,
  );
  assert.equal(
    createCommentSchema.safeParse({ ...validComment, bodyMarkdown: "a".repeat(5_000) }).success,
    true,
  );
  assert.equal(
    createCommentSchema.safeParse({ ...validComment, bodyMarkdown: "a".repeat(5_001) }).success,
    false,
  );
  for (const bodyMarkdown of ["", " \t\r\n "]) {
    assert.equal(createPostSchema.safeParse({ ...validPost, bodyMarkdown }).success, false);
    assert.equal(createCommentSchema.safeParse({ ...validComment, bodyMarkdown }).success, false);
  }
  assert.equal(createPostSchema.safeParse({ ...validPost, title: "a".repeat(121) }).success, false);
  assert.equal(createPostSchema.safeParse({ ...validPost, title: "  " }).success, false);
});

test("post image references must be valid, distinct, and no more than ten", () => {
  const images = Array.from(
    { length: 11 },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  assert.equal(
    createPostSchema.safeParse({ ...validPost, imageAssetIds: images.slice(0, 10) }).success,
    true,
  );
  assert.equal(createPostSchema.safeParse({ ...validPost, imageAssetIds: images }).success, false);
  assert.equal(
    createPostSchema.safeParse({ ...validPost, imageAssetIds: [PUBLIC_ID, PUBLIC_ID] }).success,
    false,
  );
  assert.equal(
    createPostSchema.safeParse({ ...validPost, imageAssetIds: ["not-a-uuid"] }).success,
    false,
  );
});

test("image duplicate detection treats upper and lower case UUIDs as the same database identity", () => {
  assert.equal(
    createPostSchema.safeParse({
      ...validPost,
      imageAssetIds: [PUBLIC_ID, PUBLIC_ID.toUpperCase()],
    }).success,
    false,
  );
});

test("Korean view dates switch at UTC 15:00 and include month and year boundaries", () => {
  assert.equal(koreaDate(new Date("2026-09-29T14:59:59.999Z")), "2026-09-29");
  assert.equal(koreaDate(new Date("2026-09-29T15:00:00.000Z")), "2026-09-30");
  assert.equal(koreaDate(new Date("2026-09-30T15:00:00.000Z")), "2026-10-01");
  assert.equal(koreaDate(new Date("2026-12-31T15:00:00.000Z")), "2027-01-01");
  assert.throws(() => koreaDate(new Date("invalid")), /Invalid date/);
});

test("visitor hashes are deterministic, separated by post and visitor, and reveal no source identifier", () => {
  const hash = hashVisitor(AUTHOR_ID, POST_ID, SECRET);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashVisitor(AUTHOR_ID, POST_ID, SECRET), hash);
  assert.notEqual(hashVisitor(AUTHOR_ID, OTHER_POST_ID, SECRET), hash);
  assert.notEqual(hashVisitor(OTHER_USER_ID, POST_ID, SECRET), hash);
  assert.notEqual(hashVisitor(AUTHOR_ID, POST_ID, `${SECRET}-different`), hash);
  assert.equal(hash.includes(AUTHOR_ID), false);
});

test("visitor hashes use canonical UUID identities to prevent case-based duplicate daily views", () => {
  assert.equal(
    hashVisitor(AUTHOR_ID.toUpperCase(), POST_ID.toUpperCase(), SECRET),
    hashVisitor(AUTHOR_ID, POST_ID, SECRET),
  );
});

test("visitor hash generation rejects invalid identifiers and insufficient secrets", () => {
  assert.throws(() => hashVisitor("not-a-uuid", POST_ID, SECRET));
  assert.throws(() => hashVisitor(AUTHOR_ID, "not-a-uuid", SECRET));
  assert.throws(() => hashVisitor(AUTHOR_ID, POST_ID, ""), /at least 32/);
  assert.throws(() => hashVisitor(AUTHOR_ID, POST_ID, "x".repeat(31)), /at least 32/);
  assert.match(hashVisitor(AUTHOR_ID, POST_ID, "x".repeat(32)), /^[0-9a-f]{64}$/);
});
