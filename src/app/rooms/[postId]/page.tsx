import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { AppError } from "@/server/errors";
import { ParticipationLogin, ParticipationShell } from "@/components/participation-shell";
import { AnnouncementRoom } from "@/components/announcement-room";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  try {
    return (
      <AnnouncementRoom
        key={(await params).postId}
        initial={await participationService(getDatabase()).room(actor, (await params).postId)}
      />
    );
  } catch (error) {
    if (error instanceof AppError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code))
      return (
        <ParticipationShell>
          <section className="participation-card participation-empty">
            <h1>공지방을 확인할 수 없어요</h1>
            <p>{error.message}</p>
            <Link className="participation-primary" href="/participation">
              내 신청 확인
            </Link>
          </section>
        </ParticipationShell>
      );
    throw error;
  }
}
