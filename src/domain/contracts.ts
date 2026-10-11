import type { CategorySlug } from "./categories";
import type { PostDocument } from "./post-document";

export type AuthProvider = "kakao" | "google";
export type PublicAuthor =
  | { kind: "anonymous"; displayName: "익명" }
  | { kind: "member"; displayName: string; publicProfileId: string }
  | { kind: "deleted"; displayName: "탈퇴한 회원" };

export interface PostStats {
  likeCount: number;
  bookmarkCount: number;
  viewCount: number;
  commentCount: number;
}

export interface PostSummary {
  id: string;
  categorySlug: CategorySlug;
  title: string;
  author: PublicAuthor;
  createdAt: string;
  updatedAt: string;
  stats: PostStats;
  isMine: boolean;
  isLiked: boolean;
  isBookmarked: boolean;
}

export interface PostDetail extends PostSummary {
  bodyMarkdown: string;
  bodyDocument?: PostDocument | null;
  images: PublicImage[];
  videos?: PublicVideo[];
}

export interface PublicImage {
  id: string;
  // Application route resolves private Storage objects without exposing ownership.
  src: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  sortOrder: number;
}

export interface PublicVideo {
  id: string;
  src: string;
  contentType: "video/mp4";
  byteSize: number;
  width: number;
  height: number;
  durationSeconds: number;
  sortOrder: number;
}

// Return flat, paginated rows. Avoid recursively serializing an unbounded tree.
export interface CommentItem {
  id: string;
  postId: string;
  parentId: string | null;
  author: PublicAuthor | null;
  bodyMarkdown: string | null;
  isDeleted: boolean;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  kind: "post_comment" | "comment_reply";
  postId: string;
  commentId: string;
  // Intentionally no actor or recipient account ID, avatar, or name snapshot.
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: AppErrorCode; message: string; fieldErrors?: Record<string, string[]> };
    };
