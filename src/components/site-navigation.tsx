"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  AUDIENCE_NAVIGATION,
  activeNavigationSection,
  type CommunityNavigationSection,
  type CommunityNavigationActiveSection,
} from "@/domain/navigation";
import { useAudience } from "@/lib/audience";

export function SiteNavigation({
  activeSection,
  onNavigate,
}: {
  activeSection?: CommunityNavigationActiveSection;
  onNavigate?: (section: CommunityNavigationSection) => void;
}) {
  const pathname = usePathname();
  const [audience] = useAudience();
  const { primary, more } = AUDIENCE_NAVIGATION[audience];
  const active = activeNavigationSection(pathname, activeSection);
  const secondaryActive = more.some(
    (item) => item.id === active || pathname === item.href || pathname?.startsWith(item.href + "/"),
  );
  const menuId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const [nativePopover, setNativePopover] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
  useEffect(() => closeMenu(), [pathname, audience, activeSection]);
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
    <nav className="sl-nav" aria-label="주 메뉴">
      {primary.map(({ id, label, href }) => (
        <Link
          key={id}
          href={href}
          className="sl-nav__link"
          aria-label={id === "games" ? "웹게임 (베타)" : undefined}
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
          data-active={secondaryActive || undefined}
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
          {more.map(({ id, label, href }) => (
            <Link
              key={id}
              href={href}
              onClick={closeMenu}
              aria-current={active === id || pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
