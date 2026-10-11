import { getDatabase } from "@/db/client";
import { authenticatedActor } from "@/server/identity";
import { safetyService } from "@/server/safety-service";
import { SafetyCenter } from "@/components/safety-center";
import { ParticipationLogin } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await authenticatedActor();
  if (!actor) return <ParticipationLogin />;
  return (
    <SafetyCenter kind="support" initial={await safetyService(getDatabase()).tickets(actor)} />
  );
}
