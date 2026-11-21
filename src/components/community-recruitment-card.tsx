"use client";

import { useId, type MouseEvent } from "react";
import {
  Bookmark,
  CalendarDays,
  Eye,
  Heart,
  MapPin,
  MessageCircle,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import type { CommunityPost } from "@/domain/community";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { PostAuthorName } from "./post-author-name";
import { usePostRead } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";

const eventDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const eventFeeFormatter = new Intl.NumberFormat("ko-KR");

export function CommunityRecruitmentCard({
  post,
  showImage,
  busy,
  canWrite,
  onOpen,
  onLike,
  onSave,
  onTag,
}: {
  post: CommunityPost;
  showImage: boolean;
  busy: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onLike: () => void;
  onSave: () => void;
  onTag: (tag: string) => void;
}) {
  const titleId = useId();
  const isRead = usePostRead(post.id);
  const href = postPath(post.id);
  const image = post.image ?? post.images[0]?.src;
  const category = CATEGORIES.find((item) => item.slug === post.category)?.name;
  const cancelled = !!post.eventCancelledAt;
  const closed = post.eventAvailable === false;
  const status = cancelled
    ? "모집 취소"
    : closed
      ? "모집 마감"
      : post.eventAvailable === true
        ? "모집 중"
        : "모집";
  const start = post.eventStartsAt ? new Date(post.eventStartsAt) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const eventDate = validStart
    ? eventDateFormatter.format(validStart)
    : post.eventDate?.trim() || "일정 확인 필요";
  const amount = post.eventAmountKRW;
  const fee =
    post.meetupType === "lightning" && !post.applicationUrl
      ? "현장 정산"
      : typeof amount === "number" && Number.isFinite(amount) && amount >= 0
        ? amount === 0
          ? "무료"
          : `${eventFeeFormatter.format(amount)}원`
        : post.eventFee?.trim() || "참가비 확인 필요";
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldOpenPostModal(event)) return;
    event.preventDefault();
    onOpen();
  };

  return (
    <article className={cn("recruitment-card", cancelled && "recruitment-card-cancelled")}>
      <a className="recruitment-card-open" href={href} onClick={open} aria-labelledby={titleId}>
        {showImage && (
          <div className="recruitment-card-cover" aria-hidden="true">
            {image ? (
              <img
                src={image}
                alt=""
                width={640}
                height={360}
                loading="lazy"
                decoding="async"
                className="recruitment-card-image"
              />
            ) : (
              <CalendarDays size={32} strokeWidth={1.5} />
            )}
          </div>
        )}
        <div className="recruitment-card-body">
          <div className="recruitment-card-overline">
            <span
              className={cn(
                "recruitment-card-status",
                cancelled && "recruitment-card-status-cancelled",
                !cancelled && closed && "recruitment-card-status-closed",
              )}
            >
              {status}
            </span>
            {category && <span className="recruitment-card-category">{category}</span>}
            {post.meetupType === "lightning" && (
              <span className="recruitment-card-lightning">
                <Zap size={12} aria-hidden="true" />
                번개
              </span>
            )}
          </div>
          <h3 id={titleId} className={cn("recruitment-card-title", isRead && "title-is-read")}>
            {post.title}
            {isRead && <span className="sr-only"> (읽은 글)</span>}
          </h3>
          <dl className="recruitment-card-facts">
            <div>
              <dt>
                <CalendarDays size={13} aria-hidden="true" />
                <span className="sr-only">일정 · 한국 시간</span>
              </dt>
              <dd>
                {validStart ? (
                  <time dateTime={validStart.toISOString()}>{eventDate}</time>
                ) : (
                  eventDate
                )}
              </dd>
            </div>
            <div>
              <dt>
                <Wallet size={13} aria-hidden="true" />
                <span className="sr-only">참가 비용</span>
              </dt>
              <dd className="recruitment-card-fee">{fee}</dd>
            </div>
            <div className="recruitment-card-place">
              <dt>
                <MapPin size={13} aria-hidden="true" />
                <span className="sr-only">장소</span>
              </dt>
              <dd>{post.location?.trim() || "장소 확인 필요"}</dd>
            </div>
          </dl>
        </div>
      </a>
      <footer className="recruitment-card-footer">
        <div className="recruitment-card-meta">
          <div className="recruitment-card-author">
            <UserRound size={13} aria-hidden="true" />
            <PostAuthorName post={post} />
            {post.distanceKm !== null && post.distanceKm !== undefined && (
              <span className="recruitment-card-distance">
                <MapPin size={12} aria-hidden="true" />
                {post.distanceKm < 1
                  ? `${Math.round(post.distanceKm * 1000)}m`
                  : `${post.distanceKm.toFixed(1)}km`}
              </span>
            )}
          </div>
          <div className="recruitment-card-stats">
            <span aria-label={`조회 ${post.views}회`}>
              <Eye size={13} aria-hidden="true" />
              {post.views}
            </span>
            <span aria-label={`댓글 ${post.comments}개`}>
              <MessageCircle size={13} aria-hidden="true" />
              {post.comments}
            </span>
          </div>
        </div>
        <div className="recruitment-card-actions">
          {post.tags.length > 0 && (
            <div className="recruitment-card-tags" role="group" aria-label="게시글 태그">
              {post.tags.map((tag) => (
                <button key={tag} type="button" onClick={() => onTag(tag)}>
                  #{tag}
                </button>
              ))}
            </div>
          )}
          <div className="recruitment-card-reactions">
            <button
              type="button"
              disabled={busy || !canWrite}
              onClick={onLike}
              className={cn(post.isLiked && "active")}
              aria-pressed={post.isLiked}
              aria-label={`${post.title} 좋아요`}
            >
              <Heart size={15} fill={post.isLiked ? "currentColor" : "none"} aria-hidden="true" />
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
              <Bookmark
                size={15}
                fill={post.isBookmarked ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </footer>
    </article>
  );
}
