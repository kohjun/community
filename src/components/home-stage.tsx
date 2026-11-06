"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, CalendarDays, MapPin } from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES } from "@/domain/categories";
import { HOME_PERIODS, type HomePeriod } from "@/domain/home-discovery";
import { useReadPosts } from "@/lib/use-read-posts";
import { cn } from "@/lib/utils";
import { postPath } from "@/domain/post-sharing";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { appRequest } from "@/lib/api-client";
import { SliperMark } from "./sliper-mark";

const startFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const feeFormatter = new Intl.NumberFormat("ko-KR");

function recruitStatus(post: CommunityPost) {
  if (post.sample) return { label: "모임 예시", open: false };
  if (post.eventCancelledAt) return { label: "모집 취소", open: false };
  if (post.eventAvailable === false) return { label: "모집 마감", open: false };
  if (post.eventAvailable === true) return { label: "모집 중", open: true };
  return { label: "모집", open: false };
}
function recruitDate(post: CommunityPost) {
  const start = post.eventStartsAt ? new Date(post.eventStartsAt) : null;
  if (start && !Number.isNaN(start.getTime())) return startFormatter.format(start);
  return post.eventDate?.trim() || "일정은 모집글에서 확인";
}
function recruitFee(post: CommunityPost) {
  if (post.meetupType === "lightning" && !post.applicationUrl) return "현장 정산";
  const amount = post.eventAmountKRW;
  if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
    return amount === 0 ? "무료" : `${feeFormatter.format(amount)}원`;
  return post.eventFee?.trim() || "참가비 확인 필요";
}

export function RecruitStrip({
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
  if (!posts.length) return null;
  return (
    <section className="sl-module sl-recruits" aria-labelledby="sl-recruits-title">
      <header className="sl-module__head">
        <div>
          <h2 id="sl-recruits-title">지금 모집 중인 모임</h2>
          <p>여러 호스트가 연 모임을 날짜와 장소로 비교해보세요.</p>
        </div>
        <button type="button" className="sl-text-link" onClick={onAll}>
          전체 보기
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </header>
      <RecruitTrack
        posts={posts}
        onOpen={onOpen}
        onSave={onSave}
        bookmarked={bookmarked}
        busy={busy}
        canWrite={canWrite}
      />
    </section>
  );
}

/** The horizontal recruitment cards, shared by the in-feed strip and the home section. */
export function RecruitTrack({
  posts,
  onOpen,
  onSave,
  bookmarked,
  busy,
  canWrite,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
  onSave: (id: string) => void;
  bookmarked: string[];
  busy: boolean;
  canWrite: boolean;
}) {
  const readPosts = useReadPosts();
  return (
    <div className="sl-recruits__track">
      {posts.slice(0, 8).map((post) => {
        const status = recruitStatus(post);
        const image = post.image ?? post.images[0]?.src;
        const saved = bookmarked.includes(post.id);
        const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
          if (!shouldOpenPostModal(event)) return;
          event.preventDefault();
          onOpen(post);
        };
        return (
          <article className="sl-recruit" key={post.id}>
            <a
              className="sl-recruit__cover"
              href={postPath(post.id)}
              onClick={open}
              tabIndex={-1}
              aria-hidden="true"
            >
              {image ? (
                <img src={image} alt="" loading="lazy" />
              ) : (
                <span className="sl-recruit__placeholder">
                  <SliperMark />
                </span>
              )}
              <span className={cn("sl-recruit__status", status.open && "is-open")}>
                {status.label}
              </span>
            </a>
            <button
              type="button"
              className={cn("sl-recruit__save", saved && "is-saved")}
              aria-label={post.title + " 북마크"}
              aria-pressed={saved}
              disabled={busy || !canWrite}
              onClick={() => onSave(post.id)}
            >
              <Bookmark size={16} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
            </button>
            <div className="sl-recruit__body">
              <span className="sl-recruit__meta">
                {CATEGORIES.find((c) => c.slug === post.category)?.name} ·{" "}
                {post.meetupType === "lightning" ? "번개" : "이벤트"}
              </span>
              <a href={postPath(post.id)} onClick={open}>
                <h3 className={cn(readPosts.includes(post.id) && "title-is-read")}>{post.title}</h3>
              </a>
              <dl className="sl-recruit__facts">
                <div>
                  <dt>
                    <CalendarDays size={13} aria-label="일정" />
                  </dt>
                  <dd>{recruitDate(post)}</dd>
                </div>
                <div>
                  <dt>
                    <MapPin size={13} aria-label="장소" />
                  </dt>
                  <dd>{post.location || "장소는 모집글에서 확인"}</dd>
                </div>
              </dl>
              <span className="sl-recruit__fee">{recruitFee(post)}</span>
            </div>
          </article>
        );
      })}
    </div>
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
    <section className="sl-module sl-hot" aria-labelledby="hot-title">
      <header className="sl-module__head">
        <div>
          <h2 id="hot-title">지금 반응 좋은 이야기</h2>
        </div>
        <button type="button" className="sl-text-link" onClick={() => onAll(period)}>
          더 보기
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="sl-segment" role="tablist" aria-label="인기 이야기 기간">
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
          <p className="sl-module__empty" role="status">
            {label}의 이야기를 불러오고 있어요.
          </p>
        ) : error ? (
          <p className="sl-module__empty" role="alert">
            {error}{" "}
            <button className="sl-text-link" onClick={() => setRetry((v) => v + 1)}>
              다시 불러오기
            </button>
          </p>
        ) : !items.length ? (
          <p className="sl-module__empty">
            {label} 반응이 모인 이야기가 아직 없어요. 첫 반응을 남겨보세요.
          </p>
        ) : (
          <ol className="sl-hot__list">
            {items.slice(0, 5).map((post, index) => (
              <li key={post.id}>
                <a
                  href={postPath(post.id)}
                  onClick={(e) => {
                    if (!shouldOpenPostModal(e)) return;
                    e.preventDefault();
                    onOpen(post);
                  }}
                >
                  <span className="sl-hot__rank">{index + 1}</span>
                  <span className="sl-hot__copy">
                    <strong className={cn(readPosts.includes(post.id) && "title-is-read")}>
                      {post.title}
                    </strong>
                    <span>
                      {CATEGORIES.find((c) => c.slug === post.category)?.name} · 좋아요{" "}
                      {post.popularityScore ?? 0} · 댓글 {post.comments}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="sl-hot__note">
        {period === "today" ? "오늘 0시" : period === "week" ? "이번 주 월요일" : "이번 달 1일"}
        부터 받은 좋아요 순 · 1분마다 갱신
      </p>
    </section>
  );
}
