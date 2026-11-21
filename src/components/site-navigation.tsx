"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  AUDIENCE_NAVIGATION,
  activeNavigationSection,
  type CommunityNavigationSection,
  type SiteNavigationOverride,
} from "@/domain/navigation";
import { useAudience } from "@/lib/audience";

function navLabel(id: string, label: string) {
  return (
    <>
      {label}
      {id === "games" && (
        <span className="sl-nav__badge" aria-hidden="true">
          BETA
        </span>
      )}
    </>
  );
}

export function SiteNavigation({
  activeSection,
  onNavigate,
}: {
  activeSection?: SiteNavigationOverride;
  onNavigate?: (section: CommunityNavigationSection) => void;
}) {
  const pathname = usePathname();
  const [audience] = useAudience();
  const { primary, more } = AUDIENCE_NAVIGATION[audience];
  const items = [...primary, ...more];
  const active = activeNavigationSection(pathname, activeSection);
  const menuId = useId();
  const [visibleCount, setVisibleCount] = useState<number>(primary.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const [nativePopover, setNativePopover] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isActive = (item: { id: string; href: string }) =>
    item.id === active || pathname === item.href;
  const overflow = items.slice(visibleCount);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    function fit() {
      if (!nav || !measure || !nav.clientWidth) return;
      const widths = Array.from(measure.children, (item) => item.getBoundingClientRect().width);
      const moreWidth = widths.pop() ?? 0;
      const gap = Number.parseFloat(getComputedStyle(nav).columnGap) || 0;
      const available = nav.clientWidth;
      const fullWidth =
        widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
      if (fullWidth <= available) {
        setVisibleCount(widths.length);
        return;
      }
      let width = moreWidth;
      let count = 0;
      for (const itemWidth of widths) {
        width += itemWidth + gap;
        if (width > available) break;
        count++;
      }
      setVisibleCount(count);
    }
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(nav);
    resize.observe(measure);
    return () => resize.disconnect();
  }, [audience, active, pathname]);

  function placeMenu() {
    const trigger = triggerRef.current,
      panel = panelRef.current;
    if (!trigger || !panel) return;
    const r = trigger.getBoundingClientRect();
    const width = Math.min(220, window.innerWidth - 32);
    panel.style.setProperty("--sl-menu-width", `${width}px`);
    panel.style.setProperty(
      "--sl-menu-left",
      `${Math.min(Math.max(16, r.right - width), window.innerWidth - width - 16)}px`,
    );
    panel.style.setProperty("--sl-menu-top", `${r.bottom + 8}px`);
  }
  function closeMenu() {
    if (nativePopover && panelRef.current?.matches(":popover-open")) panelRef.current.hidePopover();
    setMoreOpen(false);
  }
  useEffect(() => setNativePopover(Object.hasOwn(HTMLElement.prototype, "popover")), []);
  useEffect(() => closeMenu(), [pathname, audience, activeSection, visibleCount]);
  useEffect(() => {
    if (!moreOpen) return;
    window.addEventListener("resize", placeMenu);
    // Old browsers keep the same navigation links with a small disclosure fallback.
    const outside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    if (!nativePopover) {
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", escape);
    }
    return () => {
      window.removeEventListener("resize", placeMenu);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen, nativePopover]);

  return (
    <nav className="sl-nav" aria-label="주 메뉴" ref={navRef}>
      <div className="sl-nav__measure" aria-hidden="true">
        <div ref={measureRef}>
          {items.map((item) => (
            <span key={item.id} className="sl-nav__link" data-active={isActive(item) || undefined}>
              {navLabel(item.id, item.label)}
            </span>
          ))}
          <span className="sl-nav__link">
            더보기 <ChevronDown size={15} aria-hidden="true" />
          </span>
        </div>
      </div>
      {items.slice(0, visibleCount).map(({ id, label, href }) => (
        <Link
          key={id}
          href={href}
          className="sl-nav__link"
          aria-label={id === "games" ? "웹게임 (베타)" : undefined}
          aria-current={isActive({ id, href }) ? "page" : undefined}
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
          {navLabel(id, label)}
        </Link>
      ))}
      {overflow.length > 0 && (
        <div
          className="sl-nav__more"
          ref={moreRef}
          onBlurCapture={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
              closeMenu();
          }}
        >
          <button
            type="button"
            className="sl-nav__link"
            ref={triggerRef}
            aria-expanded={moreOpen}
            aria-controls={menuId}
            popoverTarget={nativePopover ? menuId : undefined}
            data-active={overflow.some(isActive) || undefined}
            onClick={() => {
              placeMenu();
              if (!nativePopover) setMoreOpen((open) => !open);
            }}
          >
            더보기 <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div
            id={menuId}
            className="sl-nav__menu"
            ref={panelRef}
            popover={nativePopover ? "auto" : undefined}
            hidden={!nativePopover && !moreOpen}
            onToggle={(event) => {
              if (nativePopover) setMoreOpen(event.newState === "open");
            }}
          >
            {overflow.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                onClick={closeMenu}
                aria-current={isActive(item) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
