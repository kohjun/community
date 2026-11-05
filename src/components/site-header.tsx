import Link from "next/link";
import type { ReactNode } from "react";
import { Search, UserRound } from "lucide-react";
import type { CommunityNavigationSection } from "@/domain/navigation";
import { NotificationBell } from "./notification-bell";
import { SiteNavigation } from "./site-navigation";
import { TestAccountControls } from "./test-account-controls";
import { SliperMark } from "./sliper-mark";

export function SiteBrand() {
  return (
    <Link className="sl-brand" href="/" aria-label="Sliper 홈">
      <SliperMark className="sl-brand__mark" />
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
}: {
  activeSection?: CommunityNavigationSection;
  search?: ReactNode;
}) {
  return (
    <header className="sl-header">
      <div className="sl-header__inner">
        <SiteBrand />
        <SiteNavigation {...(activeSection ? { activeSection } : {})} />
        <div className="sl-header__tools">
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
