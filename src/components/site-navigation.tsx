"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  SITE_NAVIGATION,
  activeNavigationSection,
  type CommunityNavigationSection,
} from "@/domain/navigation";

const EXTRA_LINKS = [
  { href: "/ideas", label: "모임 제안하기" },
  { href: "/hosting-guide", label: "호스트 가이드" },
  { href: "/help", label: "이용 안내" },
] as const;

export function SiteNavigation({
  activeSection,
  onNavigate,
}: {
  activeSection?: CommunityNavigationSection;
  onNavigate?: (section: CommunityNavigationSection) => void;
}) {
  const pathname = usePathname();
  const active = activeNavigationSection(pathname, activeSection);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // The brand mark already links home, so the header skips a separate 홈 item.
  const primary = SITE_NAVIGATION.filter((item) => item.primary && item.id !== "home");
  const secondary = SITE_NAVIGATION.filter((item) => !item.primary);
  const secondaryActive = secondary.some((item) => item.id === active);

  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);

  return (
    <nav className="sl-nav" aria-label="주 메뉴">
      {primary.map(({ id, label, href }) => (
        <Link
          key={id}
          href={href}
          className="sl-nav__link"
          aria-label={id === "games" ? "웹 게임 (베타)" : undefined}
          aria-current={active === id ? "page" : undefined}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            if (id === "stories") onNavigate?.(id);
          }}
        >
          {label}
          {id === "games" && (
            <span className="sl-nav__badge" aria-hidden="true">
              BETA
            </span>
          )}
        </Link>
      ))}
      <div className="sl-nav__more" ref={moreRef}>
        <button
          type="button"
          className="sl-nav__link"
          aria-expanded={moreOpen}
          aria-haspopup="true"
          data-active={secondaryActive || undefined}
          onClick={() => setMoreOpen((open) => !open)}
        >
          더보기
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {moreOpen && (
          <div className="sl-nav__menu">
            {secondary.map(({ id, label, href }) => (
              <Link key={id} href={href} aria-current={active === id ? "page" : undefined}>
                {label}
              </Link>
            ))}
            <hr />
            {EXTRA_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
