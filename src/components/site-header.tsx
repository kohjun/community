import Link from "next/link";
import type { ReactNode } from "react";
import { Bookmark, Search, UserRound } from "lucide-react";
import type { SiteNavigationOverride } from "@/domain/navigation";
import { NotificationBell } from "./notification-bell";
import { SiteNavigation } from "./site-navigation";
import { TestAccountControls } from "./test-account-controls";
import { SliperMark } from "./sliper-mark";
import { AudienceToggle } from "./audience-toggle";

/** Brand mark and wordmark shared by header and footer. */
export function SiteBrand({ mark = true }: { mark?: boolean }) {
  return (
    <Link className="sl-brand" href="/" aria-label="Sliper 홈">
      {mark && <SliperMark className="sl-brand__mark" />}
      <span className="sl-brand__word">
        sliper<span className="sl-brand__dot">.</span>
      </span>
    </Link>
  );
}

/**
 * Spacious two-row header on desktop (brand + utility row above primary navigation row),
 * with the site tools in a single row on phones.
 */
export function SiteHeader({
  activeSection,
  search,
  savedMeetupsActive = false,
}: {
  activeSection?: SiteNavigationOverride;
  search?: ReactNode;
  savedMeetupsActive?: boolean;
}) {
  return (
    <header className="sl-header">
      <div className="sl-header__inner">
        <div className="sl-header__top">
          <div className="sl-header__brand">
            <SiteBrand mark />
            <span className="sl-header__slogan">일상에 예능 한 스푼</span>
          </div>
          <div className="sl-header__tools">
            <Link
              className="sl-icon-button sl-header__favorites"
              href="/?view=bookmarks&kind=모집"
              prefetch={false}
              aria-label="찜한 모임"
              title="찜한 모임"
              aria-current={savedMeetupsActive ? "page" : undefined}
            >
              <Bookmark
                size={20}
                fill={savedMeetupsActive ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </Link>
            {search ?? (
              <Link className="sl-search-link" href="/search" aria-label="모임·이야기 통합 검색">
                <span>모임·이야기, 웹게임 검색</span>
                <Search size={18} aria-hidden="true" />
              </Link>
            )}
            <span className="sl-header__desktop-only">
              <NotificationBell />
            </span>
            <Link
              className="sl-icon-button sl-header__desktop-only"
              href="/mypage"
              aria-label="마이페이지"
              title="마이페이지"
            >
              <UserRound size={19} aria-hidden="true" />
            </Link>
            <TestAccountControls fallbackLogin />
          </div>
          <AudienceToggle />
        </div>
        <div className="sl-header__nav-row">
          <SiteNavigation {...(activeSection ? { activeSection } : {})} />
        </div>
      </div>
    </header>
  );
}
