import Link from "next/link";
import { TestAccountControls } from "./test-account-controls";
import { SiteNavigation } from "./site-navigation";
import { AdSlot } from "./ad-slot";
import { PolicyLinks } from "./policy-links";
import { NotificationBell } from "./notification-bell";
import { Megaphone, MessageCircle, UserRound } from "lucide-react";
export function ParticipationShell({
  children,
  advertising = true,
}: {
  children: React.ReactNode;
  advertising?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#participation-content">
        본문으로 바로가기
      </a>
      <header className="site-header service-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Sliper 홈">
            <img src="/images/sliper-logo.png" alt="" />
            <span>
              sliper<span className="brand-dot">.</span>
            </span>
          </Link>
          <span className="brand-slogan">슬쩍 나와서 리얼하게 노는 퍼블릭 모임</span>
          <SiteNavigation />
          <div className="header-actions">
            <NotificationBell />
            <Link className="profile-button" href="/participation" aria-label="참가 현황과 공지방">
              <MessageCircle size={20} />
            </Link>
            <Link className="profile-button" href="/mypage" aria-label="마이페이지">
              <UserRound size={20} />
            </Link>
            <TestAccountControls fallbackLogin />
          </div>
          <nav className="service-quick-nav" aria-label="나의 활동">
            <Link href="/participation">참가 현황 · 공지방</Link>
            <Link href="/management">행사 관리</Link>
            <NotificationBell label="알림함" />
          </nav>
        </div>
      </header>
      <main className="participation-page" id="participation-content">
        {advertising && <AdSlot compact />}
        {children}
      </main>
      <footer className="service-footer">
        <Link href="/">sliper.</Link>
        <span>슬쩍 나와서 리얼하게 노는 퍼블릭 모임</span>
        <small>© 2026 Sliper</small>
        <PolicyLinks />
      </footer>
    </>
  );
}
export function ParticipationLogin() {
  return (
    <ParticipationShell>
      <section className="participation-card participation-empty">
        <Megaphone size={34} />
        <h1>함께하는 즐거움을 시작해요</h1>
        <p>로그인하면 참가 신청과 나의 공지방을 확인할 수 있어요.</p>
        <Link className="participation-primary" href="/login">
          로그인 안내
        </Link>
        <small>처음이라면 이용 안내에서 신청 방법을 확인해보세요.</small>
      </section>
    </ParticipationShell>
  );
}
