import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { ParticipationLogin } from "@/components/participation-shell";
import { ParticipationDashboard } from "@/components/participation-home";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  return <ParticipationDashboard initial={await participationService(getDatabase()).home(actor)} />;
}
