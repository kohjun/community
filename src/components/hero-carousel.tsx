"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { EVENT_RECRUITMENTS_HREF, MEETUP_TYPE_LABELS } from "@/domain/meetup-types";
import { shouldAdvanceCarousel } from "@/lib/carousel";
import { cn } from "@/lib/utils";

const SLIDE_MS = 6000;
const POSTERS = [
  {
    id: "web-games",
    title: "웹게임",
    description: "설치 없이 친구와 바로 한 판 즐겨요.",
    href: "/games",
    action: "웹게임 둘러보기",
  },
  {
    id: "stories",
    title: "이야기",
    description: "예능 이야기부터 모임 후기까지 함께 나눠요.",
    href: "/stories",
    action: "이야기 보러 가기",
  },
  {
    id: "events",
    title: MEETUP_TYPE_LABELS.event,
    description: "미션 레이스와 추리 게임을 직접 체험해요.",
    href: EVENT_RECRUITMENTS_HREF,
    action: "이벤트·행사 찾아보기",
  },
  {
    id: "lightning",
    title: MEETUP_TYPE_LABELS.lightning,
    description: "시간과 취향이 맞는 소규모 모임을 찾아요.",
    href: "/lightning",
    action: "번개·모임 찾아보기",
  },
] as const;

export function HeroCarousel() {
  const count = POSTERS.length;
  const [current, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const stopped = !shouldAdvanceCarousel({ paused, hovered, focused, hidden, reducedMotion });

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
      aria-label="슬리퍼 둘러보기"
      style={{ "--sl-slide-ms": `${SLIDE_MS}ms` } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={(event) => {
        swiped.current = false;
        if (event.pointerType !== "mouse") touch.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => {
        touch.current = null;
        swiped.current = false;
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
          {POSTERS.map((poster, i) => {
            const image = `/images/home/posters/${poster.id}`;
            return (
              <div
                key={poster.id}
                className="sl-carousel__slide"
                role="group"
                aria-roledescription="slide"
                aria-label={`${count}개 중 ${i + 1}번째, ${poster.title}`}
                inert={i !== current}
              >
                <Link href={poster.href} data-poster={poster.id} draggable={false} prefetch={false}>
                  <span className="sl-carousel__copy">
                    <strong className="sl-carousel__title">{poster.title}</strong>
                    <span className="sl-carousel__description">{poster.description}</span>
                    <span className="sl-carousel__action">
                      {poster.action}
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="sl-carousel__art">
                    <img
                      src={`${image}-1440.webp`}
                      srcSet={`${image}-720.webp 720w, ${image}-1440.webp 1440w`}
                      sizes="(max-width: 720px) 100vw, (max-width: 1600px) 63vw, 970px"
                      alt=""
                      width={1440}
                      height={960}
                      loading={i === 0 ? "eager" : "lazy"}
                      fetchPriority={i === 0 ? "high" : "low"}
                      draggable={false}
                    />
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      <div className="sl-carousel__controls">
        <div className="sl-carousel__progress" role="group" aria-label="배너 선택">
          {POSTERS.map((poster, i) => (
            <button
              key={poster.id}
              type="button"
              aria-label={`${i + 1}번째 배너, ${poster.title}`}
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
    </section>
  );
}
