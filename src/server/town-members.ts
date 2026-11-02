import { eq, inArray, or } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles } from "../db/schema";
import { memberBlocks, memberSafety } from "../db/safety-schema";
import { membershipActive } from "../domain/safety";
import type { TownMember } from "./town-world";
// Only current residents are queried; no positions or routine chat are written to Postgres.
export async function loadTownMembers(db: Database, actors: string[]): Promise<TownMember[]> {
  if (!actors.length) return [];
  const [people, blocks] = await Promise.all([
    db
      .select({
        actor: profiles.id,
        publicId: profiles.publicId,
        nickname: profiles.nickname,
        status: memberSafety.status,
        until: memberSafety.suspendedUntil,
      })
      .from(profiles)
      .leftJoin(memberSafety, eq(memberSafety.userId, profiles.id))
      .where(inArray(profiles.id, actors)),
    db
      .select({ a: memberBlocks.blockerId, b: memberBlocks.blockedId })
      .from(memberBlocks)
      .where(or(inArray(memberBlocks.blockerId, actors), inArray(memberBlocks.blockedId, actors))),
  ]);
  return people
    .filter((p) => membershipActive({ status: p.status ?? "active", suspendedUntil: p.until }))
    .map((p) => ({
      actor: p.actor,
      publicId: p.publicId,
      nickname: p.nickname,
      blocked: blocks.flatMap((b) => (b.a === p.actor ? [b.b] : b.b === p.actor ? [b.a] : [])),
    }));
}
