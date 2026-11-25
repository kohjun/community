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
    eyebrow: "NEW · 3D 카메라 파티 웹게임",
    title: "설치 없이 바로 한 판, 웹게임",
    description: "스냅 팡 3D부터 라이어·경매·마음의 온도까지 모임 자리에서 QR로 바로 시작해요.",
    href: "/games",
    action: "웹게임 둘러보기",
  },
  {
    id: "events",
    eyebrow: "SLIPER PUBLIC EVENT",
    title: MEETUP_TYPE_LABELS.event,
    description: "미션 레이스와 심리 추리 게임, 예능 파티를 오프라인에서 직접 체험해요.",
    href: EVENT_RECRUITMENTS_HREF,
    action: "이벤트·행사 찾아보기",
  },
  {
    id: "lightning",
    eyebrow: "소규모 번개 모임",
    title: MEETUP_TYPE_LABELS.lightning,
    description: "시간과 취향이 맞는 사람들과 부담 없이 만나는 2~12명 번개를 찾아보세요.",
    href: "/lightning",
    action: "번개·모임 찾아보기",
  },
  {
    id: "stories",
    eyebrow: "예능 커뮤니티",
    title: "우리들의 생생한 이야기",
    description: "모임 참가 후기부터 기획 노하우, 재미있는 투표까지 함께 나눠요.",
    href: "/stories",
    action: "이야기 보러 가기",
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
            const imageVersion = poster.id === "web-games" ? "" : "?v=2";
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
                    <span className="sl-carousel__eyebrow">{poster.eyebrow}</span>
                    <strong className="sl-carousel__title">{poster.title}</strong>
                    <span className="sl-carousel__description">{poster.description}</span>
                    <span className="sl-carousel__action">
                      {poster.action}
                      <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="sl-carousel__art">
                    <img
                      src={`${image}-1440.webp${imageVersion}`}
                      srcSet={`${image}-720.webp${imageVersion} 720w, ${image}-1440.webp${imageVersion} 1440w`}
                      sizes="(max-width: 720px) 100vw, (max-width: 1440px) 58vw, 720px"
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

      <button
        type="button"
        className="sl-carousel__arrow sl-carousel__arrow--prev"
        aria-label="이전 배너"
        onClick={() => move(-1)}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        className="sl-carousel__arrow sl-carousel__arrow--next"
        aria-label="다음 배너"
        onClick={() => move(1)}
      >
        <ChevronRight size={18} />
      </button>

      <div className="sl-carousel__hud">
        <div className="sl-carousel__dots" role="group" aria-label="배너 선택">
          {POSTERS.map((poster, i) => (
            <button
              key={poster.id}
              type="button"
              aria-label={`${i + 1}번째 배너, ${poster.title}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <div className="sl-carousel__pill">
          <span className="sl-carousel__count" aria-hidden="true">
            <strong>{current + 1}</strong> / {count}
          </span>
          <button
            type="button"
            aria-label={paused ? "배너 자동 넘김 재생" : "배너 자동 넘김 일시정지"}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      </div>
    </section>
  );
}
