import { postDocumentSchema, postDocumentImageIds, postDocumentVideoIds } from "./post-document";
import type { CommentRecord, NotificationRecord, PostRecord, ProfileRecord } from "../db/types";
import type {
  CommentItem,
  NotificationItem,
  PostDetail,
  PostStats,
  PostSummary,
  PublicAuthor,
  PublicImage,
  PublicVideo,
} from "./contracts";

type AuthorProfile = Pick<ProfileRecord, "id" | "publicId" | "nickname">;

function presentAuthor(
  authorId: string | null,
  anonymous: boolean,
  profile: AuthorProfile | null,
): PublicAuthor {
  // Anonymous content remains anonymous even after account deletion.
  if (anonymous) return { kind: "anonymous", displayName: "익명" };
  if (!authorId || !profile || profile.id !== authorId)
    return { kind: "deleted", displayName: "탈퇴한 회원" };
  return { kind: "member", displayName: profile.nickname, publicProfileId: profile.publicId };
}

interface PostPresentationContext {
  profile: AuthorProfile | null;
  viewerId: string | null;
  stats: PostStats;
  isLiked: boolean;
  isBookmarked: boolean;
}

export function presentPostSummary(row: PostRecord, context: PostPresentationContext): PostSummary {
  if (row.status !== "published")
    throw new Error("Deleted posts must not be presented as public content.");
  return {
    id: row.id,
    categorySlug: row.categorySlug,
    title: row.title,
    author: presentAuthor(row.authorId, row.isAnonymous, context.profile),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stats: {
      likeCount: context.stats.likeCount,
      bookmarkCount: context.stats.bookmarkCount,
      viewCount: context.stats.viewCount,
      commentCount: context.stats.commentCount,
    },
    isMine: context.viewerId !== null && row.authorId === context.viewerId,
    isLiked: context.isLiked,
    isBookmarked: context.isBookmarked,
  };
}

export function presentPostDetail(
  row: PostRecord,
  context: PostPresentationContext,
  images: readonly PublicImage[],
  videos: readonly PublicVideo[] = [],
): PostDetail {
  return {
    ...presentPostSummary(row, context),
    bodyMarkdown: row.bodyMarkdown,
    bodyDocument: (() => {
      const parsed = postDocumentSchema.safeParse(row.bodyDocument);
      const imageIds = new Set(images.map((image) => image.id));
      const videoIds = new Set(videos.map((video) => video.id));
      return parsed.success &&
        postDocumentImageIds(parsed.data).every((id) => imageIds.has(id)) &&
        postDocumentVideoIds(parsed.data).every((id) => videoIds.has(id))
        ? parsed.data
        : null;
    })(),
    videos: videos.map((asset) => ({
      id: asset.id,
      src: `/api/videos/${asset.id}`,
      contentType: asset.contentType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      sortOrder: asset.sortOrder,
    })),
    images: images.map((asset) => ({
      id: asset.id,
      src: `/api/media/${asset.id}`,
      contentType: asset.contentType,
      sortOrder: asset.sortOrder,
    })),
  };
}

export function presentComment(
  row: CommentRecord,
  profile: AuthorProfile | null,
  viewerId: string | null,
): CommentItem {
  const deleted = row.status === "deleted";
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    author: deleted ? null : presentAuthor(row.authorId, row.isAnonymous, profile),
    bodyMarkdown: deleted ? null : row.bodyMarkdown,
    isDeleted: deleted,
    isMine: !deleted && viewerId !== null && row.authorId === viewerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentNotification(row: NotificationRecord, viewerId: string): NotificationItem {
  if (row.recipientId !== viewerId) throw new Error("Notification belongs to another member.");
  return {
    id: row.id,
    kind: row.kind,
    postId: row.postId,
    commentId: row.commentId,
    message:
      row.kind === "comment_reply" ? "내 댓글에 답글이 달렸어요." : "내 글에 새 댓글이 달렸어요.",
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
