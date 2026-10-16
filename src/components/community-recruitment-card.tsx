"use client";

import type { MouseEvent } from "react";
import {
  Bookmark,
  CalendarDays,
  Eye,
  Heart,
  MapPin,
  MessageCircle,
  UserRound,
  UsersRound,
  Wallet,
  Zap,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import type { CommunityPost } from "@/domain/community";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { usePostRead } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";
import { RecruitmentApplyButton } from "./recruitment-cta";

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
    typeof amount === "number" && Number.isFinite(amount) && amount >= 0
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
      <a className="recruitment-card-open" href={href} onClick={open}>
        <div className={cn("recruitment-card-media", !image && "recruitment-card-media-empty")}>
          {image ? (
            <img src={image} alt="" loading="lazy" className="recruitment-card-image" />
          ) : (
            <UsersRound size={44} strokeWidth={1.4} aria-hidden="true" />
          )}
          <span
            className={cn(
              "recruitment-card-status",
              cancelled && "recruitment-card-status-cancelled",
              !cancelled && closed && "recruitment-card-status-closed",
            )}
          >
            {status}
          </span>
          {post.meetupType === "lightning" && (
            <span className="recruitment-card-lightning">
              <Zap size={12} aria-hidden="true" />
              번개
            </span>
          )}
        </div>
        <div className="recruitment-card-body">
          <div className="recruitment-card-overline">
            <span className="recruitment-card-category">{category}</span>
            {post.topic && <span className="recruitment-card-topic">{post.topic}</span>}
            <span className="recruitment-card-time">{post.time}</span>
          </div>
          <h3 className={cn("recruitment-card-title", isRead && "title-is-read")}>
            {post.title}
            {isRead && <span className="sr-only"> (읽은 글)</span>}
          </h3>
          <p className="recruitment-card-excerpt">{post.excerpt}</p>
          <dl className="recruitment-card-facts">
            <div>
              <dt>
                <MapPin size={15} aria-hidden="true" />
                <span className="sr-only">장소</span>
              </dt>
              <dd>{post.location?.trim() || "장소 확인 필요"}</dd>
            </div>
            <div>
              <dt>
                <CalendarDays size={15} aria-hidden="true" />
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
                <Wallet size={15} aria-hidden="true" />
                <span className="sr-only">참가 비용</span>
              </dt>
              <dd className="recruitment-card-fee">{fee}</dd>
            </div>
          </dl>
          <div className="recruitment-card-author">
            <UserRound size={13} aria-hidden="true" />
            <span>{post.anonymous ? "익명" : post.author}</span>
            {post.distanceKm !== null && post.distanceKm !== undefined && (
              <span className="recruitment-card-distance">
                <MapPin size={12} aria-hidden="true" />
                {post.distanceKm < 1
                  ? `${Math.round(post.distanceKm * 1000)}m`
                  : `${post.distanceKm.toFixed(1)}km`}
              </span>
            )}
          </div>
        </div>
      </a>
      <div className="recruitment-card-footer">
        <div className="recruitment-card-stats">
          <span aria-label={`조회 ${post.views}회`}>
            <Eye size={14} aria-hidden="true" />
            {post.views}
          </span>
          <span aria-label={`댓글 ${post.comments}개`}>
            <MessageCircle size={14} aria-hidden="true" />
            {post.comments}
          </span>
        </div>
        <div className="recruitment-card-actions">
          <RecruitmentApplyButton
            postId={post.id}
            url={post.applicationUrl}
            cancelledAt={post.eventCancelledAt}
          />
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
      </div>
    </article>
  );
}
