"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  Compass,
  UsersRound,
  UserRound,
  Search,
  ChevronRight,
  Zap,
  BookOpen,
  MessageCircle,
  MapPin,
  Heart,
  Gamepad2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { NotificationBell } from "./notification-bell";
import { CATEGORIES } from "@/domain/categories";
import { mobileNavigationHidden, mobileSection } from "@/domain/mobile-navigation";
const links = [
  { href: "/games", label: "웹 게임", text: "링크로 모여 함께하는 게임", icon: Gamepad2 },
  { href: "/lightning", label: "번개 모임", text: "가볍고 빠른 만남", icon: Zap },
  { href: "/stories", label: "이야기", text: "취향을 나누는 게시판", icon: MessageCircle },
  { href: "/archive", label: "아카이브", text: "룰북·템플릿·행사 기록", icon: BookOpen },
  { href: "/map", label: "이벤트 맵", text: "주변의 모임과 장소", icon: MapPin },
  { href: "/ideas", label: "모임 제안", text: "이런 모임 열어주세요", icon: Heart },
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
        <DialogContent className="mobile-explore-sheet">
          <div className="mobile-sheet-handle" aria-hidden="true" />
          <header>
            <DialogTitle>어떤 즐거움을 찾나요?</DialogTitle>
            <DialogDescription>취향에 맞는 모임부터 이야기와 기획 자료까지.</DialogDescription>
          </header>
          <div className="mobile-explore-scroll">
            <Link className="mobile-explore-search" href="/search" onClick={() => setOpen(false)}>
              <Search size={19} />
              <span>이야기·모임·자료 통합 검색</span>
              <ChevronRight size={17} />
            </Link>
            <div className="mobile-explore-grid">
              {links.map(({ href, label, text, icon: Icon }) => (
                <Link href={href} key={href} onClick={() => setOpen(false)}>
                  <span className="mobile-explore-icon">
                    <Icon size={21} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{text}</small>
                  </span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
            <section className="mobile-explore-categories">
              <h3>취향별로 둘러보기</h3>
              <div>
                {CATEGORIES.map((c) => (
                  <Link key={c.slug} href={"/?category=" + c.slug} onClick={() => setOpen(false)}>
                    {c.name}
                  </Link>
                ))}
              </div>
            </section>
            <section className="mobile-explore-shortcuts">
              <h3>내가 찾던 모임을 놓치지 않게</h3>
              <Link href="/discover/saved" onClick={() => setOpen(false)}>
                조건 저장·모집 알림
                <ChevronRight size={16} />
              </Link>
              <Link href="/mypage?tab=events" onClick={() => setOpen(false)}>
                내 행사·공지방
                <ChevronRight size={16} />
              </Link>
              <Link href="/players" onClick={() => setOpen(false)}>
                플레이어·크루 찾기
                <ChevronRight size={16} />
              </Link>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
