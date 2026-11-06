import Link from "next/link";
import type { ReactNode } from "react";
import { Bookmark, Search, UserRound } from "lucide-react";
import type { CommunityNavigationSection } from "@/domain/navigation";
import { NotificationBell } from "./notification-bell";
import { SiteNavigation } from "./site-navigation";
import { TestAccountControls } from "./test-account-controls";
import { SliperMark } from "./sliper-mark";
import { AudienceToggle } from "./audience-toggle";

/** The header shows the wordmark alone; the footer keeps the slipper mark beside it. */
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
 * One header for every page. Pages with their own search (the community feed) pass it in;
 * everywhere else the search control links to the unified search page.
 */
export function SiteHeader({
  activeSection,
  search,
  savedMeetupsActive = false,
}: {
  activeSection?: CommunityNavigationSection;
  search?: ReactNode;
  savedMeetupsActive?: boolean;
}) {
  return (
    <header className="sl-header">
      <div className="sl-header__inner">
        <SiteBrand mark={false} />
        <SiteNavigation {...(activeSection ? { activeSection } : {})} />
        <AudienceToggle />
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
              <Search size={17} aria-hidden="true" />
              <span>모임·이야기 검색</span>
            </Link>
          )}
          <span className="sl-header__desktop-only">
            <NotificationBell />
          </span>
          <Link
            className="sl-icon-button sl-header__desktop-only"
            href="/mypage"
            aria-label="마이페이지"
          >
            <UserRound size={19} aria-hidden="true" />
          </Link>
          <TestAccountControls fallbackLogin />
        </div>
      </div>
    </header>
  );
}
