import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { communityGrowthService } from "@/server/community-growth-service";
import { ParticipationShell, ParticipationLogin } from "@/components/participation-shell";
import { EventReunion } from "@/components/event-reunion";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const { postId } = await params;
  return (
    <ParticipationShell>
      <EventReunion
        initial={await communityGrowthService(getDatabase()).reunionView(actor, postId)}
      />
    </ParticipationShell>
  );
}
