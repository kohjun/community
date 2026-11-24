"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarDays, Home, Plus, UserRound } from "lucide-react";
import { RecruitmentTypeDialog } from "./recruitment-type-dialog";
import { useSession } from "./session-provider";
import { loginHref } from "@/domain/login-return";
import { mobileNavigationHidden, mobileSection } from "@/domain/mobile-navigation";
import {
  EVENT_COMPOSE_HREF,
  EVENT_RECRUITMENTS_HREF,
  LIGHTNING_COMPOSE_HREF,
  MEETUP_TYPE_LABELS,
} from "@/domain/meetup-types";
import { requestInPlaceCompose } from "@/lib/recruit-compose-events";

export function MobileNavigation() {
  const path = usePathname() ?? "/",
    query = useSearchParams(),
    router = useRouter(),
    { session, ready } = useSession(),
    [recruitOpen, setRecruitOpen] = useState(false),
    active = mobileSection(path, query);

  useEffect(() => {
    setRecruitOpen(false);
  }, [path]);

  if (mobileNavigationHidden(path)) return null;

  function chooseEventRecruitment() {
    setRecruitOpen(false);
    if (ready && !session?.authenticated) {
      router.push(loginHref(EVENT_COMPOSE_HREF));
      return;
    }
    if (!requestInPlaceCompose("event")) {
      router.push(EVENT_COMPOSE_HREF);
    }
  }

  function chooseLightningRecruitment() {
    setRecruitOpen(false);
    if (ready && !session?.authenticated) {
      router.push(loginHref(LIGHTNING_COMPOSE_HREF));
      return;
    }
    if (!requestInPlaceCompose("lightning")) {
      router.push(LIGHTNING_COMPOSE_HREF);
    }
  }

  return (
    <>
      <nav className="mobile-app-nav" aria-label="모바일 메뉴">
        <Link href="/" aria-current={active === "home" ? "page" : undefined}>
          <Home size={22} />
          <span>홈</span>
        </Link>
        <Link
          href={EVENT_RECRUITMENTS_HREF}
          aria-current={active === "meetups" ? "page" : undefined}
        >
          <CalendarDays size={22} />
          <span>{MEETUP_TYPE_LABELS.event}</span>
        </Link>
        <button
          type="button"
          aria-label="모집글 올리기"
          aria-expanded={recruitOpen}
          aria-haspopup="dialog"
          data-active={recruitOpen}
          onClick={() => setRecruitOpen(true)}
        >
          <Plus size={22} aria-hidden="true" />
          <span>모집</span>
        </button>
        <Link href="/mypage" aria-current={active === "my" ? "page" : undefined}>
          <UserRound size={22} />
          <span>마이</span>
        </Link>
      </nav>
      <RecruitmentTypeDialog
        open={recruitOpen}
        onOpenChange={setRecruitOpen}
        onEvent={chooseEventRecruitment}
        onLightning={chooseLightningRecruitment}
      />
    </>
  );
}
