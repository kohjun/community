"use client";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, Handshake, Lightbulb } from "lucide-react";
import type { CommunityPost } from "@/domain/community";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import type { Audience } from "@/lib/audience";
import { CATEGORY_ICONS } from "./category-icons";
import { HeroCarousel } from "./hero-carousel";

const HOST_LINKS = [
  { href: "/management", label: "모임 관리", icon: ClipboardList },
  { href: "/archive?kind=template", label: "템플릿", icon: BookOpen },
  { href: "/players?tab=crews", label: "크루 찾기", icon: Handshake },
  { href: "/hosting-guide", label: "호스트 가이드", icon: Lightbulb },
];

export function HomeHero({
  audience,
  recruitments,
  onCategory,
  onHost,
  onOpen,
}: {
  audience: Audience;
  recruitments: CommunityPost[];
  onCategory: (category: CategorySlug) => void;
  onHost: () => void;
  onOpen: (post: CommunityPost) => void;
}) {
  return (
    <section className="sl-hero" aria-labelledby="sl-hero-title">
      <h1 id="sl-hero-title" className="sr-only">
        Sliper 모임 커뮤니티
      </h1>
      <HeroCarousel posts={recruitments} onOpen={onOpen} />
      {audience === "host" ? (
        <div className="sl-quick" role="group" aria-label="호스트 바로가기">
          <button type="button" className="sl-quick__primary" onClick={onHost}>
            <span className="sl-quick__eyebrow">호스트·기업이라면</span>
            <strong>
              모집글 올리기
              <ArrowRight size={18} aria-hidden="true" />
            </strong>
            <span className="sl-quick__what">모집·공지·입장까지 한곳에서 관리해요.</span>
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
      ) : (
        <nav className="sl-cats" aria-label="카테고리로 모임 찾기">
          {CATEGORIES.map(({ slug, name }) => {
            const Icon = CATEGORY_ICONS[slug];
            return (
              <button key={slug} type="button" onClick={() => onCategory(slug)}>
                <span className="sl-cats__icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.8} />
                </span>
                <span className="sl-cats__label">{name}</span>
              </button>
            );
          })}
        </nav>
      )}
    </section>
  );
}
