"use client";
import { useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Flame,
  MapPin,
  Bookmark,
  Sparkles,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES } from "@/domain/categories";
import { useReadPosts } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";
import { useCarouselMotion } from "@/lib/use-carousel-motion";
import { carouselPosition, nextCarouselPosition } from "@/lib/carousel";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";

export function FeaturedCarousel({
  posts,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
  onAll,
  upcoming = false,
}: {
  upcoming?: boolean;
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
  onAll: () => void;
}) {
  const readPosts = useReadPosts();
  const rail = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState(0),
    [paused, setPaused] = useState(false);
  function move(direction: number) {
    const element = rail.current,
      first = element?.firstElementChild as HTMLElement | undefined;
    if (!element || !first) return;
    const gap = parseFloat(getComputedStyle(element).gap) || 16,
      step = first.offsetWidth + gap;
    const next = nextCarouselPosition(
      element.scrollLeft,
      element.scrollWidth,
      element.clientWidth,
      step,
      direction,
    );
    element.scrollTo({
      left: next.offset,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setPosition(next.index);
  }
  const interaction = useCarouselMotion(() => move(1), 8500, paused || posts.length < 2);
  if (!posts.length)
    return upcoming ? (
      <section className="featured-section">
        <div className="section-heading">
          <h2>곧 만나요</h2>
          <button className="text-button" onClick={onAll}>
            모임 둘러보기
          </button>
        </div>
        <p className="record-note">
          다가오는 모임을 준비하고 있어요. 번개를 열어 첫 만남을 시작해보세요.
        </p>
      </section>
    ) : null;
  return (
    <section className="featured-section" aria-labelledby="featured-title" {...interaction}>
      <div className="section-heading">
        <h2 id="featured-title">
          <Sparkles size={20} className="blue" />
          {upcoming ? "곧 만나요" : "지금 주목받는 콘텐츠"}
        </h2>
        <div className="section-actions">
          <button className="text-button" onClick={onAll}>
            모두 보기
          </button>
          {posts.length > 1 && (
            <>
              <button
                className="carousel-control"
                aria-label="이전 주목받는 콘텐츠"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="carousel-control"
                aria-label="다음 주목받는 콘텐츠"
                onClick={() => move(1)}
              >
                <ChevronRight size={17} />
              </button>
              <button
                className="carousel-control"
                aria-label={paused ? "콘텐츠 자동 전환 재생" : "콘텐츠 자동 전환 일시정지"}
                aria-pressed={paused}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className="featured-grid featured-rail"
        ref={rail}
        onScroll={() => {
          const element = rail.current,
            first = element?.firstElementChild as HTMLElement | undefined;
          if (element && first)
            setPosition(
              carouselPosition(
                element.scrollLeft,
                element.scrollWidth,
                element.clientWidth,
                first.offsetWidth + (parseFloat(getComputedStyle(element).gap) || 16),
              ).index,
            );
        }}
      >
        {posts.map((post, index) => (
          <article className="feature-card" key={post.id}>
            <a
              className="feature-open"
              href={postPath(post.id)}
              onClick={(event) => {
                if (!shouldOpenPostModal(event)) return;
                event.preventDefault();
                onOpen(post);
              }}
              aria-label={`${post.title} 자세히 보기${readPosts.includes(post.id) ? " (읽은 글)" : ""}`}
            >
              <div className="feature-image">
                {post.image ? (
                  <img src={post.image} alt="" />
                ) : (
                  <div className="feature-placeholder">
                    <Sparkles size={40} />
                  </div>
                )}
                <span className="episode">
                  {upcoming ? "다가오는 모임" : "추천 " + String(index + 1).padStart(2, "0")}
                </span>
                <span className="recruitment">
                  {post.kind === "모집" ? "함께할 사람 모집" : post.kind}
                </span>
              </div>
              <div className="feature-info">
                <span className="category-text">
                  {CATEGORIES.find((item) => item.slug === post.category)?.name}
                </span>
                <h3 className={cn(readPosts.includes(post.id) && "title-is-read")}>
                  {post.title}
                  {readPosts.includes(post.id) && <span className="sr-only"> (읽은 글)</span>}
                </h3>
                <p>
                  <MapPin size={13} />
                  {post.location || "함께 나누는 이야기"}
                </p>
                <p className="event-date">{post.eventDate || post.time}</p>
              </div>
            </a>
            <button
              className={cn("card-bookmark", bookmarked.includes(post.id) && "saved")}
              aria-label={`${post.title} 북마크`}
              aria-pressed={bookmarked.includes(post.id)}
              disabled={busy || !canWrite}
              onClick={() => onSave(post.id)}
            >
              <Bookmark size={17} fill={bookmarked.includes(post.id) ? "currentColor" : "none"} />
            </button>
          </article>
        ))}
      </div>
      <div className="carousel-caption">
        <span>취향에 맞는 다음 에피소드를 발견해요</span>
        <span>
          {Math.min(position + 1, posts.length)} / {posts.length}
        </span>
      </div>
    </section>
  );
}
export function HotStories({
  posts,
  onOpen,
  onAll,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onAll: () => void;
}) {
  const readPosts = useReadPosts();
  return (
    <section className="hot-stories" aria-labelledby="hot-title">
      <div className="section-heading">
        <h2 id="hot-title">
          <Flame className="blue" size={20} />
          오늘 반응이 좋은 이야기
          <span className="live-dot" aria-hidden="true" />
        </h2>
        <button className="text-button" onClick={onAll}>
          더 보기
          <ChevronRight size={15} />
        </button>
      </div>
      {!posts.length && (
        <p className="record-note">
          오늘의 첫 반응을 기다리고 있어요. 아래에서 최신 이야기를 만나보세요.
        </p>
      )}
      <div className="hot-story-grid">
        {posts.slice(0, 4).map((post, index) => (
          <a
            key={post.id}
            href={postPath(post.id)}
            onClick={(event) => {
              if (!shouldOpenPostModal(event)) return;
              event.preventDefault();
              onOpen(post);
            }}
          >
            <span className="hot-rank">{String(index + 1).padStart(2, "0")}</span>
            <span className="hot-copy">
              <small>{CATEGORIES.find((item) => item.slug === post.category)?.name}</small>
              <strong className={cn(readPosts.includes(post.id) && "title-is-read")}>
                {post.title}
                {readPosts.includes(post.id) && <span className="sr-only"> (읽은 글)</span>}
              </strong>
              <span>
                오늘 좋아요 {post.popularityScore ?? 0} · 댓글 {post.comments}
              </span>
            </span>
            <ArrowUpRight size={16} />
          </a>
        ))}
      </div>
      <p className="hot-footnote">한국 시간 오늘 받은 좋아요 순 · 1분마다 확인해요.</p>
    </section>
  );
}
