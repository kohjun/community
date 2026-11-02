"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  CalendarDays,
  Ticket,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES } from "@/domain/categories";
import { HOME_PERIODS, type HomePeriod } from "@/domain/home-discovery";
import { useReadPosts } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";
import { useCarouselMotion } from "@/lib/use-carousel-motion";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { appRequest } from "@/lib/api-client";
export function FeaturedCarousel({
  posts,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
  onAll,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
  onAll: () => void;
}) {
  const readPosts = useReadPosts(),
    [position, setPosition] = useState(0),
    [paused, setPaused] = useState(false),
    [direction, setDirection] = useState("left"),
    rotation = useRef(0),
    touch = useRef<{ x: number; y: number } | null>(null),
    swiped = useRef(false);
  const index = posts.length ? position % posts.length : 0,
    post = posts[index];
  function move(step: number, axis?: string) {
    if (posts.length < 2) return;
    setDirection(axis ?? (step > 0 ? "left" : "right"));
    setPosition((value) => (value + step + posts.length) % posts.length);
  }
  const interaction = useCarouselMotion(
    () => {
      const axes = ["left", "up", "right", "down"];
      move(1, axes[rotation.current++ % 4]);
    },
    7000,
    paused || posts.length < 2,
  );
  if (!post)
    return (
      <section className="home-recruitment">
        <div className="section-heading">
          <h2>지금 주목받는 모임</h2>
          <button className="text-button" onClick={onAll}>
            모집 둘러보기
          </button>
        </div>
        <p className="record-note">새로운 모임을 준비하고 있어요. 원하는 모임을 찾아보세요.</p>
        <Link className="record-backlink" href="/ideas">
          이런 모임 열어주세요 →
        </Link>
      </section>
    );
  const available = !!post.eventAvailable && !post.sample && !post.eventCancelledAt;
  function open(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!shouldOpenPostModal(event)) return;
    event.preventDefault();
    onOpen(post!);
  }
  return (
    <section
      className="home-recruitment"
      aria-roledescription="carousel"
      aria-label="추천 모임"
      {...interaction}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const dx = e.clientX - start.x,
          dy = e.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
        swiped.current = true;
        const horizontal = Math.abs(dx) > Math.abs(dy);
        move(
          (horizontal ? dx : dy) < 0 ? 1 : -1,
          horizontal ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down",
        );
      }}
      onClickCapture={(e) => {
        if (swiped.current) {
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="section-heading">
        <h2>
          <Sparkles className="blue" size={20} />
          지금 주목받는 모임
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
                <ChevronLeft size={18} />
              </button>
              <button
                className="carousel-control"
                aria-label="다음 주목받는 콘텐츠"
                onClick={() => move(1)}
              >
                <ChevronRight size={18} />
              </button>
              <button
                className="carousel-control"
                aria-label={paused ? "콘텐츠 자동 전환 재생" : "콘텐츠 자동 전환 일시정지"}
                aria-pressed={paused}
                onClick={() => setPaused(!paused)}
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="home-feature-window" aria-live={paused ? "polite" : "off"}>
        <article
          key={post.id}
          className="home-feature"
          data-direction={direction}
          aria-roledescription="slide"
          aria-label={`${index + 1} / ${posts.length}`}
        >
          <a
            className="home-feature-cover"
            href={postPath(post.id)}
            onClick={open}
            aria-label={post.title + " 자세히 보기"}
          >
            {post.image ? (
              <img src={post.image} alt="" />
            ) : (
              <div className="home-feature-art">
                <img src="/images/sliper-logo.png" alt="" />
                <span>
                  오늘의 취향이
                  <br />
                  진짜 만남이 되는 곳
                </span>
              </div>
            )}
            <span className="home-feature-status">
              {post.sample ? "샘플 콘텐츠" : available ? "참가 신청 중" : "모집 내용 살펴보기"}
            </span>
          </a>
          <div className="home-feature-copy">
            <div className="home-feature-top">
              <span>
                {CATEGORIES.find((c) => c.slug === post.category)?.name} ·{" "}
                {post.meetupType === "lightning" ? "번개 모임" : "이벤트"}
              </span>
              <button
                className={cn("home-feature-save", bookmarked.includes(post.id) && "saved")}
                aria-label={post.title + " 북마크"}
                aria-pressed={bookmarked.includes(post.id)}
                disabled={busy || !canWrite}
                onClick={() => onSave(post.id)}
              >
                <Bookmark size={19} fill={bookmarked.includes(post.id) ? "currentColor" : "none"} />
              </button>
            </div>
            <a href={postPath(post.id)} onClick={open}>
              <h3 className={cn(readPosts.includes(post.id) && "title-is-read")}>{post.title}</h3>
            </a>
            <p className="home-feature-description">{post.excerpt}</p>
            <dl>
              <div>
                <dt>
                  <MapPin size={15} />
                  장소
                </dt>
                <dd>{post.location || "모집글에서 확인"}</dd>
              </div>
              <div>
                <dt>
                  <CalendarDays size={15} />
                  일정
                </dt>
                <dd>{post.eventDate || "모집글에서 확인"}</dd>
              </div>
              <div>
                <dt>
                  <Ticket size={15} />
                  참가비
                </dt>
                <dd>
                  {post.meetupType === "lightning" && !post.applicationUrl
                    ? "현장 정산"
                    : post.eventFee || "모집글에서 확인"}
                </dd>
              </div>
            </dl>
            {available ? (
              <Link className="home-feature-apply" href={"/events/" + post.id}>
                참가 신청하기
                <ArrowUpRight size={17} />
              </Link>
            ) : (
              <a className="home-feature-apply secondary" href={postPath(post.id)} onClick={open}>
                {post.sample ? "콘텐츠 예시 살펴보기" : "모집 내용 보기"}
                <ArrowUpRight size={17} />
              </a>
            )}
          </div>
        </article>
      </div>
      <div className="home-feature-pagination">
        <span>
          {String(index + 1).padStart(2, "0")} / {String(posts.length).padStart(2, "0")}
        </span>
        <div aria-label="추천 모임 선택">
          {posts.map((p, i) => (
            <button
              key={p.id}
              className={i === index ? "selected" : ""}
              aria-label={`${i + 1}번째 모임: ${p.title}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => {
                setDirection(i > index ? "left" : "right");
                setPosition(i);
              }}
            />
          ))}
        </div>
        <small>
          {post.sample ? "실제 참가 모집이 아닌 예시예요." : "내 취향에 맞는 모임을 만나보세요."}
        </small>
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
  onAll: (period: HomePeriod) => void;
}) {
  const readPosts = useReadPosts(),
    [period, setPeriod] = useState<HomePeriod>("today"),
    [items, setItems] = useState(posts),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    first = useRef(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (period === "today") setItems(posts);
  }, [posts, period]);
  useEffect(() => {
    const controller = new AbortController();
    let version = 0;
    async function load() {
      const current = ++version;
      setBusy(true);
      setError("");
      try {
        const next = await appRequest<CommunityPost[]>(
          "/api/community/home-stories?period=" + period,
          "GET",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted && current === version) setItems(next);
      } catch (e) {
        if (!controller.signal.aborted && current === version) {
          setItems([]);
          setError(e instanceof Error ? e.message : "이야기를 불러오지 못했어요.");
        }
      } finally {
        if (!controller.signal.aborted && current === version) setBusy(false);
      }
    }
    if (first.current) first.current = false;
    else void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [period, retry]);
  const label = HOME_PERIODS.find((p) => p.value === period)!.label;
  return (
    <section className="hot-stories home-hot" aria-labelledby="hot-title">
      <div className="section-heading">
        <h2 id="hot-title">
          <Flame className="blue" size={20} />
          지금 나누는 이야기
        </h2>
        <button className="text-button" onClick={() => onAll(period)}>
          더 보기
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="home-hot-tabs" role="tablist" aria-label="인기 이야기 기간">
        {HOME_PERIODS.map((p, i) => (
          <button
            key={p.value}
            role="tab"
            aria-selected={period === p.value}
            tabIndex={period === p.value ? 0 : -1}
            aria-controls="home-hot-panel"
            id={"home-hot-" + p.value}
            onClick={() => setPeriod(p.value)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = (i + step + 3) % 3;
              setPeriod(HOME_PERIODS[next]!.value);
              (
                e.currentTarget.parentElement?.querySelectorAll("[role=tab]")[next] as HTMLElement
              )?.focus();
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div
        id="home-hot-panel"
        role="tabpanel"
        aria-labelledby={"home-hot-" + period}
        aria-busy={busy}
      >
        {busy ? (
          <p className="record-note" role="status">
            {label}의 이야기를 불러오고 있어요.
          </p>
        ) : error ? (
          <p role="alert">
            {error}{" "}
            <button className="text-button" onClick={() => setRetry((v) => v + 1)}>
              다시 불러오기
            </button>
          </p>
        ) : !items.length ? (
          <p className="record-note">
            {label}에 반응이 모인 이야기가 아직 없어요. 새로운 이야기를 만나보세요.
          </p>
        ) : (
          <div className="hot-story-grid">
            {items.slice(0, 4).map((post, index) => (
              <a
                key={post.id}
                href={postPath(post.id)}
                onClick={(e) => {
                  if (!shouldOpenPostModal(e)) return;
                  e.preventDefault();
                  onOpen(post);
                }}
              >
                <span className="hot-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="hot-copy">
                  <small>{CATEGORIES.find((c) => c.slug === post.category)?.name}</small>
                  <strong className={cn(readPosts.includes(post.id) && "title-is-read")}>
                    {post.title}
                  </strong>
                  <span>
                    {label} 좋아요 {post.popularityScore ?? 0} · 댓글 {post.comments}
                  </span>
                </span>
                <ArrowUpRight size={16} />
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="hot-footnote">
        한국 시간{" "}
        {period === "today" ? "오늘 0시" : period === "week" ? "이번 주 월요일" : "이번 달 1일"}부터
        받은 좋아요 순 · 1분마다 확인해요.
      </p>
    </section>
  );
}
