import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { communityGrowthService } from "@/server/community-growth-service";
import { ParticipationShell, ParticipationLogin } from "@/components/participation-shell";
import { MeetingIdeas } from "@/components/meeting-ideas";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sourceEventId?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const q = await searchParams,
    source = z.uuid().safeParse(q.sourceEventId);
  return (
    <ParticipationShell>
      <MeetingIdeas
        initial={await communityGrowthService(getDatabase()).ideas(actor)}
        sourceEventId={source.success ? source.data : null}
      />
    </ParticipationShell>
  );
}
