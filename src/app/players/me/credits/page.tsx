import type { Metadata } from "next";
import Link from "next/link";
import { currentActor } from "@/server/identity";
import { RecordsLogin } from "@/components/event-records";
import { MyEventCredits } from "@/components/event-credits";
import { ParticipationShell } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "제작진 확인 요청 | Sliper",
  robots: { index: false, follow: false },
};
export default async function Page() {
  if (!(await currentActor())) return <RecordsLogin returnTo="/players/me/credits" />;
  return (
    <ParticipationShell>
      <div className="record-page">
        <header className="record-heading">
          <div>
            <span className="record-kicker">YOUR CREDITS</span>
            <h1>함께 만든 경험을 확인해주세요</h1>
            <p>담당자가 확인한 제작 기여를 수락하면 내 포트폴리오에 반영됩니다.</p>
          </div>
          <Link className="participation-secondary" href="/players">
            플레이어 프로필
          </Link>
        </header>
        <MyEventCredits defaultOpen />
      </div>
    </ParticipationShell>
  );
}
