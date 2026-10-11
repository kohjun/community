import Link from "next/link";
import { currentActor } from "@/server/identity";
import { communityService } from "@/server/community-service";
import { getDatabase } from "@/db/client";
import { safeProfileReturnTo } from "@/domain/profile";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { ParticipationShell } from "@/components/participation-shell";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const query = await searchParams;
  const returnTo = safeProfileReturnTo(query.returnTo);
  const actor = await currentActor();
  if (!actor)
    return (
      <ParticipationShell>
        <section className="profile-onboarding onboarding-guest">
          <h1>슬리퍼에서 함께 놀아요</h1>
          <p>로그인한 뒤 닉네임과 연락처를 저장하면 모임을 간편하게 신청할 수 있어요.</p>
          <Link
            className="account-primary"
            href={
              "/login?returnTo=" +
              encodeURIComponent("/signup?returnTo=" + encodeURIComponent(returnTo))
            }
          >
            로그인하고 기본정보 입력하기
          </Link>
          <small>
            처음 로그인하면 닉네임과 연락처를 한 번 저장하고, 다음 행사부터 간편하게 신청할 수
            있어요.
          </small>
        </section>
      </ParticipationShell>
    );
  const initial = await communityService(getDatabase()).me(actor);
  return <ProfileOnboarding initial={initial} returnTo={returnTo} />;
}
