"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Home, UserRound } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { EVENT_RECRUITMENTS_HREF, MEETUP_TYPE_LABELS } from "@/domain/meetup-types";
import { mobileNavigationHidden, mobileSection } from "@/domain/mobile-navigation";

export function MobileNavigation() {
  const path = usePathname() ?? "/";
  const query = useSearchParams();
  if (mobileNavigationHidden(path)) return null;
  const active = mobileSection(path, query);

  return (
    <nav className="mobile-app-nav" aria-label="모바일 메뉴">
      <Link href="/" aria-current={active === "home" ? "page" : undefined}>
        <Home aria-hidden="true" />
        <span>홈</span>
      </Link>
      <Link href={EVENT_RECRUITMENTS_HREF} aria-current={active === "meetups" ? "page" : undefined}>
        <CalendarDays aria-hidden="true" />
        <span>{MEETUP_TYPE_LABELS.event}</span>
      </Link>
      <div className="mobile-app-notifications" data-active={active === "notifications"}>
        <NotificationBell mobile />
      </div>
      <Link href="/mypage" aria-current={active === "my" ? "page" : undefined}>
        <UserRound aria-hidden="true" />
        <span>마이</span>
      </Link>
    </nav>
  );
}
