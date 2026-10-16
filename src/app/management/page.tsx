import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { participationService } from "@/server/participation-service";
import { eventAftercareService } from "@/server/event-aftercare-service";
import { ParticipationLogin } from "@/components/participation-shell";
import { ManagedEvents } from "@/components/managed-events";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const database = getDatabase();
  const [initial, initialAftercare] = await Promise.all([
    participationService(database).managedEvents(actor),
    eventAftercareService(database).list(actor, { scope: "hosting", view: "pending" }),
  ]);
  return <ManagedEvents initial={initial} initialAftercare={initialAftercare} />;
}
