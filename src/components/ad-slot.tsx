"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import type { CategorySlug } from "@/domain/categories";
import { cn } from "@/lib/utils";
import { useCarouselMotion } from "@/lib/use-carousel-motion";

const ads = [
  {
    eyebrow: "함께 만드는 주말",
    title: "보는 예능을, 우리의 주말로.",
    description: "다음 모임의 주인공은 우리. 취향에 맞는 콘텐츠를 찾아보세요.",
    action: "모집 콘텐츠 둘러보기",
    category: "party" as CategorySlug,
    href: "/lightning",
    tone: "blue",
    symbol: "✦",
  },
  {
    eyebrow: "우리만의 재미 찾기",
    title: "한 장면에서 시작된 새로운 놀이.",
    description: "흥미로운 기법을 나누고, 우리만의 미션으로 다시 만들어봐요.",
    action: "콘텐츠 연구소 가기",
    category: "lab" as CategorySlug,
    href: "/stories",
    tone: "gray",
    symbol: "◉",
  },
  {
    eyebrow: "함께할 크루 찾기",
    title: "다음 에피소드, 함께 만들어요.",
    description: "MC부터 기획 파트너까지. 재미를 함께 만들 크루를 만나세요.",
    action: "크루 만나보기",
    category: "crew" as CategorySlug,
    href: "/players?tab=crews",
    tone: "soft",
    symbol: "⚑",
  },
];
export function AdSlot({
  onCategory,
  compact = false,
}: {
  onCategory?: (category: CategorySlug) => void;
  compact?: boolean;
}) {
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false);
  const interaction = useCarouselMotion(
    () => setIndex((current) => (current + 1) % ads.length),
    7000,
    paused,
  );
  const ad = ads[index]!;
  return (
    <section
      className={cn("ad-slot", ad.tone, compact && "ad-slot--compact")}
      data-ad-slot={compact ? "site-inline" : "community-inline"}
      aria-label="광고 배너 공간"
      {...interaction}
    >
      <div className="ad-label">광고 공간 · 미리보기</div>
      <div className="ad-copy" key={index}>
        <span>{ad.eyebrow}</span>
        <h2>{ad.title}</h2>
        <p>{ad.description}</p>
        {onCategory ? (
          <button type="button" onClick={() => onCategory(ad.category)}>
            {ad.action}
            <ArrowUpRight size={16} />
          </button>
        ) : (
          <Link href={ad.href}>
            {ad.category === "lab" ? "이야기 둘러보기" : ad.action}
            <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
      <div className="ad-art" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="floating-symbol">{ad.symbol}</span>
        <span className="mini-spark">✧</span>
      </div>
      <div className="ad-controls">
        <div className="carousel-dots">
          {ads.map((_, i) => (
            <button
              key={i}
              aria-label={`${i + 1}번 광고 보기`}
              aria-pressed={index === i}
              className={index === i ? "active" : ""}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <span>
          {index + 1} / {ads.length}
        </span>
        <button
          className="carousel-control"
          aria-label={paused ? "광고 자동 전환 재생" : "광고 자동 전환 일시정지"}
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      </div>
    </section>
  );
}
