"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pause,
  Play,
} from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import type { CategorySlug } from "@/domain/categories";
import { CATEGORIES } from "@/domain/categories";
import { postPath } from "@/domain/post-sharing";
import { shouldAdvanceCarousel } from "@/lib/carousel";
import { shouldOpenPostModal } from "@/lib/post-sharing";
import { cn } from "@/lib/utils";

const SLIDE_MS = 4000;
const MAX_SLIDES = 5;
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

type Scene = "race" | "mystery" | "party";
const sceneFor: Partial<Record<CategorySlug, Scene>> = {
  race: "race",
  sports: "race",
  travel: "race",
  survival: "race",
  "mind-games": "mystery",
  knowledge: "mystery",
  lab: "mystery",
  party: "party",
  dating: "party",
  music: "party",
  cooking: "party",
};
const scenes: Scene[] = ["race", "mystery", "party"];

interface Slide {
  key: string;
  scene: Scene;
  image?: string | undefined;
  badge: string;
  open: boolean;
  kicker: string;
  title: string;
  meta: string[];
  post?: CommunityPost;
  href: string;
  action: string;
}

/** Shown only when no recruitment exists yet, so the slot never sits empty. */
const fallbackSlides: Slide[] = [
  {
    key: "intro-race",
    scene: "race",
    badge: "슬리퍼 모임",
    open: false,
    kicker: "미션 레이스 · 야외",
    title: "한강에서 팀을 짜고 미션을 깨는 주말",
    meta: ["처음 와도 팀으로 함께해요"],
    href: "/?kind=모집",
    action: "모집 중인 모임 보기",
  },
  {
    key: "intro-mystery",
    scene: "mystery",
    badge: "슬리퍼 모임",
    open: false,
    kicker: "추리 게임 · 실내",
    title: "퇴근 후, 단서를 맞춰보는 두 시간",
    meta: ["룰북으로 직접 열어볼 수도 있어요"],
    href: "/archive?kind=rulebook",
    action: "룰북 둘러보기",
  },
  {
    key: "intro-party",
    scene: "party",
    badge: "슬리퍼 모임",
    open: false,
    kicker: "취향 파티 · 루프탑",
    title: "자기소개 대신 취향 카드로 시작하는 밤",
    meta: ["번개로 가볍게 모여도 좋아요"],
    href: "/lightning",
    action: "번개 모임 보기",
  },
];

function slideFrom(post: CommunityPost, index: number): Slide {
  const start = post.eventStartsAt ? new Date(post.eventStartsAt) : null;
  const date =
    start && !Number.isNaN(start.getTime()) ? startFormatter.format(start) : post.eventDate?.trim();
  const amount = post.eventAmountKRW;
  const fee =
    post.meetupType === "lightning" && !post.applicationUrl
      ? "현장 정산"
      : typeof amount === "number" && Number.isFinite(amount) && amount >= 0
        ? amount === 0
          ? "무료"
          : `${feeFormatter.format(amount)}원`
        : post.eventFee?.trim();
  const open = !!post.eventAvailable && !post.sample && !post.eventCancelledAt;
  return {
    key: post.id,
    scene: sceneFor[post.category] ?? scenes[index % scenes.length]!,
    image: post.image ?? post.images[0]?.src,
    badge: post.sample
      ? "모임 예시"
      : post.featured
        ? "추천 모임"
        : open
          ? "모집 중"
          : post.eventCancelledAt
            ? "모집 취소"
            : "모집 마감",
    open,
    kicker: `${CATEGORIES.find((c) => c.slug === post.category)?.name ?? "모임"} · ${
      post.meetupType === "lightning" ? "번개" : "이벤트"
    }`,
    title: post.title,
    meta: [date, post.location, fee].filter((value): value is string => !!value),
    post,
    href: postPath(post.id),
    action: open ? "자세히 보고 신청하기" : "모집 내용 보기",
  };
}

/** Promoted first, then open recruitments, then the rest in their existing popularity order. */
export function heroSlides(posts: CommunityPost[]): Slide[] {
  const rank = (post: CommunityPost) =>
    (post.featured && !post.sample ? 0 : 2) +
    (post.eventAvailable && !post.sample && !post.eventCancelledAt ? 0 : 1);
  const ordered = posts
    .map((post, order) => ({ post, order }))
    .sort((a, b) => rank(a.post) - rank(b.post) || a.order - b.order)
    .slice(0, MAX_SLIDES)
    .map(({ post }, index) => slideFrom(post, index));
  return ordered.length ? ordered : fallbackSlides;
}

function SlideImage({ slide, eager }: { slide: Slide; eager: boolean }) {
  const loading = eager ? "eager" : "lazy";
  if (slide.image) return <img src={slide.image} alt="" loading={loading} />;
  return (
    <img
      src={`/images/home/${slide.scene}-1200.webp`}
      srcSet={`/images/home/${slide.scene}-640.webp 640w, /images/home/${slide.scene}-1200.webp 1200w`}
      sizes="(max-width: 720px) 100vw, 600px"
      alt=""
      width={1200}
      height={750}
      loading={loading}
      {...(eager ? { fetchPriority: "high" as const } : {})}
    />
  );
}

export function HeroCarousel({
  posts,
  onOpen,
}: {
  posts: CommunityPost[];
  onOpen: (post: CommunityPost) => void;
}) {
  const slides = heroSlides(posts);
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const current = Math.min(index, count - 1);
  const stopped =
    count < 2 || !shouldAdvanceCarousel({ paused, hovered, focused, hidden, reducedMotion });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(reduce.matches);
    const visibility = () => setHidden(document.hidden);
    update();
    reduce.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      reduce.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  // A fresh timer per slide keeps every slide on screen for the full interval.
  useEffect(() => {
    if (stopped) return;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % count), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [current, stopped, count]);

  const move = (step: number) => setIndex((value) => (value + step + count) % count);

  return (
    <section
      className={cn("sl-carousel", stopped && "is-stopped")}
      aria-roledescription="carousel"
      aria-label="추천 모임"
      style={{ "--sl-slide-ms": `${SLIDE_MS}ms` } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse") touch.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
        swiped.current = true;
        move(dx < 0 ? 1 : -1);
      }}
      onClickCapture={(event) => {
        if (!swiped.current) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="sl-carousel__viewport" aria-live={stopped ? "polite" : "off"}>
        <div className="sl-carousel__track" style={{ transform: `translateX(-${current * 100}%)` }}>
          {slides.map((slide, i) => {
            const active = i === current;
            const content = (
              <>
                <SlideImage slide={slide} eager={i === 0} />
                <span className="sl-carousel__shade" aria-hidden="true" />
                <span className="sl-carousel__copy">
                  <span className="sl-carousel__chips">
                    <span className={cn("sl-carousel__badge", slide.open && "is-open")}>
                      {slide.badge}
                    </span>
                    <span>{slide.kicker}</span>
                  </span>
                  <strong className="sl-carousel__title">{slide.title}</strong>
                  {slide.meta.length > 0 && (
                    <span className="sl-carousel__meta">
                      {slide.meta.map((value, m) => (
                        <span key={m}>
                          {m === 0 && slide.post && <CalendarDays size={14} aria-hidden="true" />}
                          {m === 1 && <MapPin size={14} aria-hidden="true" />}
                          {value}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="sl-carousel__action">
                    {slide.action}
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </span>
              </>
            );
            return (
              <div
                key={slide.key}
                className="sl-carousel__slide"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${count}`}
                inert={!active}
              >
                {slide.post ? (
                  <a
                    href={slide.href}
                    draggable={false}
                    onClick={(event) => {
                      if (!shouldOpenPostModal(event)) return;
                      event.preventDefault();
                      onOpen(slide.post!);
                    }}
                  >
                    {content}
                  </a>
                ) : (
                  <Link href={slide.href} draggable={false}>
                    {content}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {count > 1 && (
        <div className="sl-carousel__controls">
          <div className="sl-carousel__progress" role="group" aria-label="배너 선택">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                aria-label={`${i + 1}번째 배너: ${slide.title}`}
                aria-current={i === current ? "true" : undefined}
                onClick={() => setIndex(i)}
              >
                {i === current && <i key={`${i}:${stopped}`} />}
              </button>
            ))}
          </div>
          <span className="sl-carousel__count" aria-hidden="true">
            {String(current + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
          </span>
          <button type="button" aria-label="이전 배너" onClick={() => move(-1)}>
            <ChevronLeft size={17} />
          </button>
          <button type="button" aria-label="다음 배너" onClick={() => move(1)}>
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            aria-label={paused ? "배너 자동 넘김 재생" : "배너 자동 넘김 일시정지"}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      )}
    </section>
  );
}
