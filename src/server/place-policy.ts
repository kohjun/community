import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { communityVenues } from "../db/venue-schema";
import { contentVisible } from "./safety-visibility";
import { creditMemberVisible } from "./event-credit-service";

/** Current visibility controls discovery; historic facts remain in the database. */
export function registeredVenueVisible(actor: string | null): SQL {
  return sql`${communityVenues.status}='published' and ${communityVenues.ownerId} is not null
    and ${contentVisible("venue", communityVenues.id)}
    and ${creditMemberVisible(actor ?? "00000000-0000-0000-0000-000000000000", communityVenues.ownerId)}`;
}
export async function visibleRegisteredVenue(
  db: Database,
  actor: string | null,
  id: string,
): Promise<boolean> {
  const [venue] = await db
    .select({ id: communityVenues.id })
    .from(communityVenues)
    .where(and(eq(communityVenues.id, id), registeredVenueVisible(actor)))
    .limit(1);
  return !!venue;
}

/** A snapshot contains immutable facts but never bypasses its current source ACL. */
export function registeredVenueSnapshotVisible(actor: string, snapshot: SQL): SQL<boolean> {
  return sql<boolean>`exists(select 1 from sliper.community_venues sv
 where sv.id::text=${snapshot}->'venue'->>'id' and sv.status='published' and sv.owner_id is not null
 and ${contentVisible("venue", sql`sv.id`)} and ${creditMemberVisible(actor, sql`sv.owner_id`)})`;
}
