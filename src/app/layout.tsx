import type { Metadata } from "next";
import { getAdvertisingConfiguration } from "@/server/advertising-config";
import localFont from "next/font/local";
import "./globals.css";
import "./community-expansion.css";
import "./participation.css";
import "./modern-marketplace.css";
import "./library-playbook.css";
import "./event-discovery.css";
import "./community-controls.css";
import "./recruitment-view.css";
import "./community-pagination.css";
import "./participation-compact.css";
import "./push-onboarding.css";
import "./profile-onboarding.css";
import "./application-questions.css";
import "./profile-photos.css";
import "./room-members.css";
import "./ad-placement.css";
import "./adsense.css";
import "./category-sidebar.css";
import "./read-posts.css";
import "./community-safety.css";
import "./operations.css";
import "./release-readiness.css";
import "./appeals.css";
import "./event-operations.css";
import "./event-lifecycle.css";
import "./event-private-contact.css";
import "./engagement.css";
import "./post-body.css";
import "./post-editor.css";
import "./topic-connections.css";
import "./post-sharing.css";
import "./unified-search.css";
import "./crew.css";
import "./event-records.css";
import "./event-aftercare.css";
import "./naver-event-map.css";
import { PushOnboardingProvider } from "@/components/push-onboarding";
import { SiteAdvertising } from "@/components/site-advertising";
import { ActivityDayTracker } from "@/components/activity-day-tracker";
import "./community-improvements.css";
import { NotificationProvider } from "@/components/notification-bell";

const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  weight: "45 920",
  style: "normal",
  display: "swap",
  variable: "--font-pretendard",
});

const siteMetadata: Metadata = {
  title: "Sliper — 일상에 예능 한 스푼",
  description:
    "여행부터 추리 게임, 예능 파티까지. 취향 맞는 사람들과 만드는 우리만의 예능 커뮤니티 Sliper.",
  robots: { index: false, follow: false },
  applicationName: "Sliper",
  appleWebApp: { capable: true, title: "Sliper", statusBarStyle: "default" },
  icons: { apple: "/images/sliper-icon-192.png" },
};

export function generateMetadata(): Metadata {
  const config = getAdvertisingConfiguration();
  return {
    ...siteMetadata,
    ...(config.clientId && config.siteOrigin
      ? { other: { "google-adsense-account": config.clientId } }
      : {}),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable} data-scroll-behavior="smooth">
      <body>
        <PushOnboardingProvider>
          <NotificationProvider>
            <ActivityDayTracker />
            <SiteAdvertising>{children}</SiteAdvertising>
          </NotificationProvider>
        </PushOnboardingProvider>
      </body>
    </html>
  );
}
