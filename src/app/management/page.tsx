import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { ParticipationLogin } from "@/components/participation-shell";
import { ManagedEvents } from "@/components/managed-events";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  return <ManagedEvents initial={await participationService(getDatabase()).managedEvents(actor)} />;
}
