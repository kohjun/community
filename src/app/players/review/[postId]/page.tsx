import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { playerService } from "@/server/player-service";
import { AppError } from "@/server/errors";
import { PlayerMannerReview } from "@/components/player-manner-review";
import { ParticipationShell, ParticipationLogin } from "@/components/participation-shell";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params,
    actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  if (!z.uuid().safeParse(postId).success) notFound();
  try {
    return (
      <PlayerMannerReview
        key={postId}
        initial={await playerService(getDatabase()).reviewable(actor, postId)}
      />
    );
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError && ["CONFLICT", "FORBIDDEN"].includes(e.code))
      return (
        <ParticipationShell>
          <section className="participation-card">
            <h1>참가 확인 후 평가할 수 있어요</h1>
            <p>{e.message}</p>
          </section>
        </ParticipationShell>
      );
    throw e;
  }
}
