import { and, eq, sql, type SQL } from "drizzle-orm";
import { eventRecords } from "../db/schema";
import { libraryVersions, templateProvenance } from "../db/library-schema";
import type { Database } from "../db/connection";
import { recordVisible } from "./record-policy";

// The list filter and evidence page use the same source/version and current record ACL.
export function libraryUsageConditions(actor: string, entryId: string | SQL) {
  return and(
    eq(templateProvenance.entryId, entryId),
    recordVisible(actor),
    sql`${eventRecords.snapshot}->'template'->>'id'=${templateProvenance.entryId}::text`,
    sql`((${templateProvenance.versionId} is null
      and ${eventRecords.snapshot}->'template'->>'versionId' is null
      and ${eventRecords.snapshot}->'template'->>'versionNumber' is null) or (
      ${libraryVersions.entryId}=${templateProvenance.entryId}
      and ${eventRecords.snapshot}->'template'->>'versionId'=${templateProvenance.versionId}::text
      and ${eventRecords.snapshot}->'template'->>'versionNumber'=${libraryVersions.number}::text))`,
  );
}
export function visibleLibraryUseCases(db: Pick<Database, "select">, actor: string | null) {
  if (!actor) return sql<number>`0`;
  // Keep the nested query builder intact: the outer single-table projection
  // must not strip qualified names from these joins or the record ACL.
  const cases = db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventRecords)
    .innerJoin(templateProvenance, eq(templateProvenance.postId, eventRecords.postId))
    .leftJoin(libraryVersions, eq(libraryVersions.id, templateProvenance.versionId))
    .where(libraryUsageConditions(actor, sql.raw('"sliper"."library_entries"."id"')));
  return sql<number>`(${cases})`;
}
