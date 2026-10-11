import Link from "next/link";
import { currentActor } from "@/server/identity";
import { communityService } from "@/server/community-service";
import { getDatabase } from "@/db/client";
import { ParticipationShell } from "@/components/participation-shell";
import { MyPage } from "@/components/my-page";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor();
  if (!actor)
    return (
      <ParticipationShell>
        <main className="account-page">
          <Link className="account-back" href="/">
            ← 커뮤니티로
          </Link>
          <div className="account-empty">
            <img src="/images/sliper-logo.png" alt="Sliper" />
            <h1>나의 다음 에피소드를 만나세요</h1>
            <p>프로필, 북마크와 활동점수를 한곳에서 확인해요.</p>
            <Link className="account-primary" href="/login">
              로그인 페이지로
            </Link>
            <small>인증 연동 후 마이페이지를 사용할 수 있어요.</small>
          </div>
        </main>
      </ParticipationShell>
    );
  const profile = await communityService(getDatabase()).me(actor);
  return <MyPage initial={profile} />;
}
