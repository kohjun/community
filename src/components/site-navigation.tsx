"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  SITE_NAVIGATION,
  activeNavigationSection,
  type CommunityNavigationSection,
} from "@/domain/navigation";

export function SiteNavigation({
  activeSection,
  onNavigate,
}: {
  activeSection?: CommunityNavigationSection;
  onNavigate?: (section: CommunityNavigationSection) => void;
}) {
  const pathname = usePathname();
  const active = activeNavigationSection(pathname, activeSection);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const selected = nav?.querySelector<HTMLAnchorElement>('[aria-current="page"]');
    if (!nav || !selected) return;
    const revealSelection = () => {
      const viewport = nav.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      const delta =
        item.left < viewport.left
          ? item.left - viewport.left - 8
          : item.right > viewport.right
            ? item.right - viewport.right + 8
            : 0;
      if (delta) {
        nav.scrollLeft = Math.max(
          0,
          Math.min(nav.scrollLeft + delta, nav.scrollWidth - nav.clientWidth),
        );
      }
    };
    revealSelection();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(revealSelection);
    observer?.observe(nav);
    observer?.observe(selected);
    window.addEventListener("resize", revealSelection);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", revealSelection);
    };
  }, [active, pathname]);

  return (
    <nav ref={navRef} className="top-nav" aria-label="주 메뉴">
      {SITE_NAVIGATION.map(({ id, label, href }) => (
        <Link
          key={id}
          href={href}
          className={active === id ? "active" : undefined}
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
            if (id === "home" || id === "stories") onNavigate?.(id);
          }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
