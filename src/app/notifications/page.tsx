import Link from "next/link";
import { Bell } from "lucide-react";
import { currentActor } from "@/server/identity";
import { ParticipationShell } from "@/components/participation-shell";
import { UnifiedNotifications } from "@/components/unified-notifications";

export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await currentActor()))
    return (
      <ParticipationShell>
        <section className="participation-card inbox-login">
          <span className="inbox-empty-icon">
            <Bell size={24} />
          </span>
          <h1>나의 새로운 소식을 모아봐요</h1>
          <p>댓글, 모임 공지와 구독한 모집 소식을 한곳에서 확인하세요.</p>
          <Link className="participation-primary" href="/login">
            로그인하고 알림 확인
          </Link>
        </section>
      </ParticipationShell>
    );
  return <UnifiedNotifications />;
}
