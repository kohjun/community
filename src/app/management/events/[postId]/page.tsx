import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { AppError } from "@/server/errors";
import { ParticipationLogin, ParticipationShell } from "@/components/participation-shell";
import { EventManagementDashboard } from "@/components/event-dashboard";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const { postId } = await params;
  try {
    return (
      <EventManagementDashboard
        key={postId}
        initial={await participationService(getDatabase()).dashboard(actor, postId)}
      />
    );
  } catch (e) {
    if (e instanceof AppError && ["FORBIDDEN", "NOT_FOUND"].includes(e.code))
      return (
        <ParticipationShell>
          <section className="participation-card participation-empty">
            <h1>행사 관리 화면을 확인할 수 없어요</h1>
            <p>{e.message}</p>
            <Link href="/management" className="participation-secondary">
              내 행사 관리
            </Link>
          </section>
        </ParticipationShell>
      );
    throw e;
  }
}
