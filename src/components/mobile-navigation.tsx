"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  Compass,
  UsersRound,
  UserRound,
  ChevronRight,
  Zap,
  BookOpen,
  MessageCircle,
  MapPin,
  Heart,
  Gamepad2,
  CalendarDays,
  Handshake,
  Lightbulb,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { NotificationBell } from "./notification-bell";
import { mobileNavigationHidden, mobileSection } from "@/domain/mobile-navigation";
const groups = [
  {
    title: "플레이",
    links: [
      { href: "/?kind=모집", label: "모집 중인 모임", icon: CalendarDays },
      { href: "/lightning", label: "번개 모임", icon: Zap },
      { href: "/map", label: "이벤트 맵", icon: MapPin },
      { href: "/games", label: "웹 게임", icon: Gamepad2 },
    ],
  },
  {
    title: "커뮤니티",
    links: [
      { href: "/stories", label: "이야기", icon: MessageCircle },
      { href: "/players", label: "플레이어·크루", icon: Handshake },
      { href: "/ideas", label: "모임 제안", icon: Heart },
    ],
  },
  {
    title: "아카이브",
    links: [
      { href: "/archive?kind=template", label: "템플릿", icon: BookOpen },
      { href: "/hosting-guide", label: "호스트 가이드", icon: Lightbulb },
    ],
  },
];
export function MobileNavigation() {
  const path = usePathname() ?? "/",
    query = useSearchParams(),
    [open, setOpen] = useState(false),
    active = mobileSection(path, query);
  useEffect(() => setOpen(false), [path]);
  if (mobileNavigationHidden(path)) return null;
  return (
    <>
      <nav className="mobile-app-nav" aria-label="모바일 메뉴">
        <Link href="/" aria-current={active === "home" ? "page" : undefined}>
          <Home size={22} />
          <span>홈</span>
        </Link>
        <Link href="/?kind=모집" aria-current={active === "meetups" ? "page" : undefined}>
          <UsersRound size={22} />
          <span>모임</span>
        </Link>
        <button
          type="button"
          aria-label="탐색 메뉴 열기"
          aria-expanded={open}
          aria-haspopup="dialog"
          data-active={active === "explore" || open}
          onClick={() => setOpen(true)}
        >
          <Compass size={23} />
          <span>탐색</span>
        </button>
        <div className="mobile-app-notifications" data-active={active === "notifications"}>
          <NotificationBell mobile />
        </div>
        <Link href="/mypage" aria-current={active === "my" ? "page" : undefined}>
          <UserRound size={22} />
          <span>마이</span>
        </Link>
      </nav>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-explore-sheet sl-explore">
          <div className="mobile-sheet-handle" aria-hidden="true" />
          <header>
            <DialogTitle>둘러보기</DialogTitle>
            <DialogDescription>찾는 곳을 골라보세요.</DialogDescription>
          </header>
          <div className="mobile-explore-scroll">
            {groups.map((group) => (
              <section className="sl-explore__group" key={group.title}>
                <h3>{group.title}</h3>
                {group.links.map(({ href, label, icon: Icon }) => (
                  <Link href={href} key={href} onClick={() => setOpen(false)}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
