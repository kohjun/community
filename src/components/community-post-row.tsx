"use client";
import { DISCUSSION_LABELS, previewPost } from "@/domain/discussions";
import {
  Bookmark,
  Eye,
  Heart,
  MessageCircle,
  UserRound,
  MapPin,
  Zap,
  BadgeCheck,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES } from "@/domain/categories";
import { RecruitmentApplyButton } from "./recruitment-cta";
import { usePostRead } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";
export function CommunityPostRow({
  post,
  busy,
  canWrite,
  onOpen,
  onLike,
  onSave,
  onTag,
}: {
  post: CommunityPost;
  busy: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onLike: () => void;
  onSave: () => void;
  onTag: (tag: string) => void;
}) {
  post = previewPost(post);
  const isRead = usePostRead(post.id);
  const href = postPath(post.id);
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!shouldOpenPostModal(event)) return;
    event.preventDefault();
    onOpen();
  };
  return (
    <article className="post-row expanded-post-row">
      <div className="post-overline">
        <span>{CATEGORIES.find((category) => category.slug === post.category)?.name}</span>
        <span
          className={cn(
            "kind-badge",
            post.kind === "모집" && !post.eventCancelledAt && "recruiting",
          )}
        >
          {post.kind === "모집" && post.eventCancelledAt
            ? "모집 취소"
            : post.kind === "후기"
              ? "이야기"
              : post.kind}
        </span>
        {post.verifiedParticipation && (
          <span className="verified-review-badge">
            <BadgeCheck size={12} />
            참가 인증 후기
          </span>
        )}
        {post.meetupType === "lightning" && (
          <span className="nearby-badge">
            <Zap size={12} />
            번개
          </span>
        )}
        {post.distanceKm !== null && post.distanceKm !== undefined && (
          <span className="nearby-badge">
            <MapPin size={12} />
            {post.distanceKm < 1
              ? `${Math.round(post.distanceKm * 1000)}m`
              : `${post.distanceKm.toFixed(1)}km`}
          </span>
        )}
        {post.kind === "이야기" && (
          <span className="discussion-badge">
            {DISCUSSION_LABELS[post.discussionType ?? "free"]}
            {post.discussionType === "question"
              ? post.acceptedAnswerId
                ? " · 해결됨"
                : " · 미해결"
              : ""}
          </span>
        )}
        {post.spoiler && <span className="spoiler-badge">스포일러</span>}
        {post.topic && <span>{post.topic}</span>}
        <span className="post-time">{post.time}</span>
      </div>
      <div className="list-title-row">
        <a className="post-title-open" href={href} onClick={open}>
          <h3 className={cn(isRead && "title-is-read")}>
            {post.title}
            {isRead && <span className="sr-only"> (읽은 글)</span>}
          </h3>
        </a>
      </div>
      <a className="post-body-open" href={href} onClick={open}>
        <div>
          <p className="post-excerpt">{post.excerpt}</p>
          <div className="post-author">
            <UserRound size={13} />
            {post.anonymous ? "익명" : post.author}
            <span>·</span>
            <Eye size={14} />
            {post.views}
            <span>·</span>
            <MessageCircle size={14} />
            {post.comments}
          </div>
        </div>
        {post.image && <img className="post-thumbnail" src={post.image} alt="" loading="lazy" />}
      </a>
      {post.tags.length > 0 && (
        <div className="row-tags post-row-tags">
          {post.tags.map((tag) => (
            <button key={tag} type="button" className="post-tag" onClick={() => onTag(tag)}>
              #{tag}
            </button>
          ))}
        </div>
      )}
      <div className="row-actions post-row-actions">
        {post.kind === "모집" && (
          <RecruitmentApplyButton
            postId={post.id}
            url={post.applicationUrl}
            cancelledAt={post.eventCancelledAt}
          />
        )}
        <div className="post-row-reactions">
          <button
            type="button"
            disabled={busy || !canWrite}
            onClick={onLike}
            className={cn(post.isLiked && "active")}
            aria-pressed={post.isLiked}
            aria-label={`${post.title} 좋아요`}
          >
            <Heart size={15} fill={post.isLiked ? "currentColor" : "none"} />
            {post.likes}
          </button>
          <button
            type="button"
            disabled={busy || !canWrite}
            onClick={onSave}
            className={cn(post.isBookmarked && "active")}
            aria-pressed={post.isBookmarked}
            aria-label={`${post.title} 북마크`}
          >
            <Bookmark size={15} fill={post.isBookmarked ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </article>
  );
}
