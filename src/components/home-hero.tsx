"use client";
import Link from "next/link";
import {
  BookOpen,
  CalendarHeart,
  ClipboardList,
  Gamepad2,
  Handshake,
  MapPin,
  PlusCircle,
  Zap,
} from "lucide-react";
import type { Audience } from "@/lib/audience";
import { EVENT_RECRUITMENTS_HREF } from "@/domain/meetup-types";
import { HOSTED_EVENTS_HREF } from "@/domain/workspace-navigation";
import { HeroCarousel } from "./hero-carousel";

const PARTICIPANT_QUICK = [
  {
    href: EVENT_RECRUITMENTS_HREF,
    title: "이벤트·행사 찾기",
    subtitle: "미션 레이스·추리 모임 한눈에",
    icon: CalendarHeart,
    tone: "blue",
  },
  {
    href: "/lightning",
    title: "오늘의 번개·모임",
    subtitle: "2~12명 가볍게 만나는 소규모 모임",
    icon: Zap,
    tone: "amber",
  },
  {
    href: "/games",
    title: "웹게임 · 스냅 팡 3D",
    subtitle: "설치 없이 QR로 바로 한 판",
    icon: Gamepad2,
    tone: "violet",
  },
  {
    href: "/map",
    title: "내 주변 이벤트 맵",
    subtitle: "지도로 보는 모임·추천 장소",
    icon: MapPin,
    tone: "teal",
  },
] as const;

const HOST_QUICK = [
  {
    href: HOSTED_EVENTS_HREF,
    title: "모임 관리",
    subtitle: "참가 승인·공지방·QR 입장 확인",
    icon: ClipboardList,
    tone: "blue",
  },
  {
    href: "/archive?kind=template",
    title: "룰북·템플릿 아카이브",
    subtitle: "바로 여는 기획서·큐시트",
    icon: BookOpen,
    tone: "teal",
  },
  {
    href: "/players?tab=crews",
    title: "함께할 크루 찾기",
    subtitle: "MC·스태프·기획 파트너 모집",
    icon: Handshake,
    tone: "violet",
  },
] as const;

export function HomeHero({ audience, onHost }: { audience: Audience; onHost: () => void }) {
  return (
    <section className="sl-hero" aria-labelledby="sl-hero-title">
      <h1 id="sl-hero-title" className="sl-sr-only">
        슬쩍 나와서 리얼하게 노는 퍼블릭 커뮤니티 Sliper
      </h1>
      <div className="sl-hero__stage">
        <aside
          className="sl-hero-quick"
          aria-label={audience === "host" ? "호스트 바로가기" : "주요 메뉴 바로가기"}
        >
          {audience === "host" ? (
            <>
              <button
                type="button"
                className="sl-hero-quick__item sl-hero-quick__item--primary"
                onClick={onHost}
              >
                <span className="sl-hero-quick__icon" data-tone="primary" aria-hidden="true">
                  <PlusCircle size={20} />
                </span>
                <span className="sl-hero-quick__copy">
                  <strong>모집글 올리기</strong>
                  <small>이벤트·번개 개설부터 입장 관리까지</small>
                </span>
              </button>
              {HOST_QUICK.map(({ href, title, subtitle, icon: Icon, tone }) => (
                <Link key={href} href={href} className="sl-hero-quick__item" prefetch={false}>
                  <span className="sl-hero-quick__icon" data-tone={tone} aria-hidden="true">
                    <Icon size={19} />
                  </span>
                  <span className="sl-hero-quick__copy">
                    <strong>{title}</strong>
                    <small>{subtitle}</small>
                  </span>
                </Link>
              ))}
            </>
          ) : (
            PARTICIPANT_QUICK.map(({ href, title, subtitle, icon: Icon, tone }) => (
              <Link key={href} href={href} className="sl-hero-quick__item" prefetch={false}>
                <span className="sl-hero-quick__icon" data-tone={tone} aria-hidden="true">
                  <Icon size={19} />
                </span>
                <span className="sl-hero-quick__copy">
                  <strong>{title}</strong>
                  <small>{subtitle}</small>
                </span>
              </Link>
            ))
          )}
        </aside>
        <HeroCarousel />
      </div>
    </section>
  );
}
