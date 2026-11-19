"use client";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, Handshake, Lightbulb } from "lucide-react";
import type { Audience } from "@/lib/audience";
import { HeroCarousel } from "./hero-carousel";

const HOST_LINKS = [
  { href: "/management", label: "모임 관리", icon: ClipboardList },
  { href: "/archive?kind=template", label: "템플릿", icon: BookOpen },
  { href: "/players?tab=crews", label: "크루 찾기", icon: Handshake },
  { href: "/hosting-guide", label: "호스트 가이드", icon: Lightbulb },
];

export function HomeHero({ audience, onHost }: { audience: Audience; onHost: () => void }) {
  return (
    <section className="sl-hero" aria-labelledby="sl-hero-title">
      <header className="sl-hero__heading">
        <h1 id="sl-hero-title">슬쩍 나와서 리얼하게 노는 퍼블릭 커뮤니티</h1>
      </header>
      <HeroCarousel />
      {audience === "host" && (
        <div className="sl-quick" role="group" aria-label="호스트 바로가기">
          <button type="button" className="sl-quick__primary" onClick={onHost}>
            <span className="sl-quick__eyebrow">호스트·기업이라면</span>
            <strong>
              모집글 올리기
              <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span className="sl-quick__what">
              이벤트·행사나 번개·모임을 골라 모집하고 공지·입장까지 관리해요.
            </span>
          </button>
          {HOST_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sl-quick__link" prefetch={false}>
              <span className="sl-quick__icon" aria-hidden="true">
                <Icon size={19} />
              </span>
              {label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
