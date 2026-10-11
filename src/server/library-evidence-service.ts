import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { eventRecords, profiles } from "../db/schema";
import { libraryVersions, templateProvenance } from "../db/library-schema";
import { libraryEvidenceQuerySchema, type LibraryEvidencePage } from "../domain/library-evidence";
import { AppError } from "./errors";
import { libraryService } from "./library-service";
import { recordMetricProjection } from "./record-service";
import { requireRecordMember } from "./record-policy";
import { registeredVenueSnapshotVisible } from "./place-policy";

import { libraryUsageConditions } from "./library-discovery";

export function libraryEvidenceService(db: Database) {
  async function list(
    actor: string | null,
    entryId: string,
    input: unknown = {},
  ): Promise<LibraryEvidencePage> {
    const user = await requireRecordMember(db, actor);
    z.uuid().parse(entryId);
    const value = libraryEvidenceQuerySchema.parse(input);
    return db.transaction(async (tx) => {
      // This applies the same current source ACL as the archive; paid bodies are discarded.
      const source = await libraryService(tx as unknown as Database).detail(user, entryId);
      if (source.status !== "published")
        throw new AppError("NOT_FOUND", "발행된 자료의 운영 사례만 볼 수 있어요.");
      const conditions = libraryUsageConditions(user, entryId);
      const filtered = and(
        conditions,
        value.version ? eq(libraryVersions.number, value.version) : undefined,
      );
      const [found, count, versions, legacy] = await Promise.all([
        tx
          .select({
            postId: eventRecords.postId,
            snapshot: eventRecords.snapshot,
            completedAt: eventRecords.completedAt,
            versionNumber: libraryVersions.number,
            venueVisible: registeredVenueSnapshotVisible(user, sql`${eventRecords.snapshot}`),
            ...recordMetricProjection(user),
          })
          .from(eventRecords)
          .innerJoin(templateProvenance, eq(templateProvenance.postId, eventRecords.postId))
          .leftJoin(libraryVersions, eq(libraryVersions.id, templateProvenance.versionId))
          .innerJoin(profiles, eq(profiles.id, eventRecords.ownerId))
          .where(filtered)
          .orderBy(desc(eventRecords.completedAt), desc(eventRecords.postId))
          .limit(20)
          .offset((value.page - 1) * 20),
        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(eventRecords)
          .innerJoin(templateProvenance, eq(templateProvenance.postId, eventRecords.postId))
          .leftJoin(libraryVersions, eq(libraryVersions.id, templateProvenance.versionId))
          .innerJoin(profiles, eq(profiles.id, eventRecords.ownerId))
          .where(filtered),
        tx
          .select({ number: libraryVersions.number, caseCount: sql<number>`count(*)::int` })
          .from(eventRecords)
          .innerJoin(templateProvenance, eq(templateProvenance.postId, eventRecords.postId))
          .innerJoin(libraryVersions, eq(libraryVersions.id, templateProvenance.versionId))
          .innerJoin(profiles, eq(profiles.id, eventRecords.ownerId))
          .where(conditions)
          .groupBy(libraryVersions.number)
          .orderBy(desc(libraryVersions.number))
          .limit(200),
        tx
          .select({ total: sql<number>`count(*)::int` })
          .from(eventRecords)
          .innerJoin(templateProvenance, eq(templateProvenance.postId, eventRecords.postId))
          .leftJoin(libraryVersions, eq(libraryVersions.id, templateProvenance.versionId))
          .innerJoin(profiles, eq(profiles.id, eventRecords.ownerId))
          .where(and(conditions, isNull(templateProvenance.versionId))),
      ]);
      const total = Number(count[0]?.total ?? 0);
      return {
        items: found.map((row) => ({
          postId: row.postId,
          title: row.snapshot.title,
          category: row.snapshot.category,
          location:
            row.snapshot.venue && !row.venueVisible ? "장소 정보 비공개" : row.snapshot.location,
          startsAt: row.snapshot.startsAt,
          endsAt: row.snapshot.endsAt,
          completedAt: row.completedAt.toISOString(),
          versionNumber: row.versionNumber,
          attended: Number(row.attended),
          qrAttended: Number(row.qrAttended),
          managerAttended: Number(row.managerAttended),
          reviewCount: Number(row.reviewCount),
          averageRating: row.averageRating === null ? null : Number(row.averageRating),
        })),
        total,
        page: value.page,
        pageCount: Math.ceil(total / 20),
        versions: versions.map((row) => ({ number: row.number, caseCount: Number(row.caseCount) })),
        legacyCount: Number(legacy[0]?.total ?? 0),
      };
    });
  }
  return { list };
}
