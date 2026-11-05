import { LoginLink } from "./login-link";
import { AdSlot } from "./ad-slot";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { Megaphone } from "lucide-react";
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
      <SiteHeader />
      <main className="participation-page" id="participation-content">
        {children}
        {/* Below the content so each page opens with its own title, not a banner. */}
        {advertising && <AdSlot compact />}
      </main>
      <SiteFooter />
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
        <LoginLink className="participation-primary">로그인 안내</LoginLink>
        <small>처음이라면 이용 안내에서 신청 방법을 확인해보세요.</small>
      </section>
    </ParticipationShell>
  );
}
