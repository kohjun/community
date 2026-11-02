import Link from "next/link";
import { currentActor } from "@/server/identity";
import { communityService } from "@/server/community-service";
import { eventAftercareService } from "@/server/event-aftercare-service";
import { participationService } from "@/server/participation-service";
import { getDatabase } from "@/db/client";
import { ParticipationShell } from "@/components/participation-shell";
import { MyPage } from "@/components/my-page";
import { MyPageNavigation } from "@/components/workspace-navigation";
import { ManagedEvents } from "@/components/managed-events";
import { ParticipationDashboard } from "@/components/participation-home";
import { HOSTED_EVENTS_HREF, MY_EVENTS_HREF, myPageSection } from "@/domain/workspace-navigation";
import { loginHref } from "@/domain/login-return";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const section = myPageSection(await searchParams);
  const actor = await currentActor();
  if (!actor) {
    const returnTo =
      section === "profile"
        ? "/mypage"
        : section === "hosting"
          ? HOSTED_EVENTS_HREF
          : MY_EVENTS_HREF;
    return (
      <ParticipationShell advertising={false}>
        <MyPageNavigation section={section} />
        <section className="account-page">
          <div className="account-empty">
            <img src="/images/sliper-logo.png" alt="Sliper" />
            <h1>나의 다음 에피소드를 만나세요</h1>
            <p>로그인하고 프로필·활동과 신청한 행사, 운영하는 행사를 확인해요.</p>
            <Link className="account-primary" href={loginHref(returnTo)}>
              로그인하고 확인하기
            </Link>
          </div>
        </section>
      </ParticipationShell>
    );
  }
  const database = getDatabase();
  if (section === "hosting") {
    const [initial, initialAftercare] = await Promise.all([
      participationService(database).managedEvents(actor),
      eventAftercareService(database).list(actor, { scope: "hosting", view: "pending" }),
    ]);
    return (
      <ParticipationShell advertising={false}>
        <MyPageNavigation section={section} />
        <ManagedEvents initial={initial} initialAftercare={initialAftercare} embedded />
      </ParticipationShell>
    );
  }
  if (section === "participating") {
    const initial = await participationService(database).home(actor);
    return (
      <ParticipationShell advertising={false}>
        <MyPageNavigation section={section} />
        <ParticipationDashboard initial={initial} embedded />
      </ParticipationShell>
    );
  }
  const [profile, initialAftercare] = await Promise.all([
    communityService(database).me(actor),
    eventAftercareService(database).list(actor, { scope: "all", view: "pending" }),
  ]);
  return <MyPage initial={profile} initialAftercare={initialAftercare} />;
}
