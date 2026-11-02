import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { savedSearchService } from "@/server/saved-search-service";
import { ParticipationShell, ParticipationLogin } from "@/components/participation-shell";
import { SavedSearches } from "@/components/saved-searches";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  return (
    <ParticipationShell>
      <SavedSearches initial={await savedSearchService(getDatabase()).list(actor)} />
    </ParticipationShell>
  );
}
