import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, MapPin, UserRound } from "lucide-react";
import type { SiteNavigationOverride } from "@/domain/navigation";
import { NotificationBell } from "./notification-bell";
import { SiteNavigation } from "./site-navigation";
import { TestAccountControls } from "./test-account-controls";
import { SliperMark } from "./sliper-mark";
import { AudienceToggle } from "./audience-toggle";
import { DynamicHeaderSearch } from "./dynamic-search-box";

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
 * collapsing cleanly to a compact responsive bar on phones.
 */
export function SiteHeader({
  activeSection,
  search,
}: {
  activeSection?: SiteNavigationOverride;
  search?: ReactNode;
}) {
  return (
    <header className="sl-header">
      <div className="sl-header__inner">
        <div className="sl-header__top">
          <div className="sl-header__brand">
            <SiteBrand mark />
            <span className="sl-header__slogan">일상에 예능 한 스푼</span>
          </div>
          <div className="sl-header__search">{search ?? <DynamicHeaderSearch />}</div>
          <div className="sl-header__tools">
            <span className="sl-header__notifications">
              <NotificationBell />
            </span>
            <div className="sl-header__desktop-only">
              <Link
                className="sl-icon-button"
                href="/mypage"
                aria-label="마이페이지"
                title="마이페이지"
              >
                <UserRound size={19} aria-hidden="true" />
              </Link>
              <TestAccountControls fallbackLogin />
            </div>
          </div>
          <AudienceToggle />
        </div>
        <div className="sl-header__nav-row">
          <SiteNavigation {...(activeSection ? { activeSection } : {})} />
          <div className="sl-header__shortcuts" aria-label="빠른 바로가기">
            <Link href="/map" className="sl-header__shortcut" prefetch={false}>
              <MapPin size={14} aria-hidden="true" />
              이벤트 맵
            </Link>
            <Link href="/archive" className="sl-header__shortcut" prefetch={false}>
              <BookOpen size={14} aria-hidden="true" />
              아카이브
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
