import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventRecords, profiles } from "../db/schema";
import { eventVenueLinks } from "../db/venue-schema";
import { placeHistoryQuerySchema, type PlaceHistoryPage } from "../domain/place-history";
import { registeredVenueSnapshotSchema } from "../domain/place-snapshot";
import { uuidSchema } from "../domain/validation";
import { eventMapService } from "./event-map-service";
import { requireRecordMember, recordVisible } from "./record-policy";
import { visibleRegisteredVenue } from "./place-policy";
import { recordMetricProjection, recordSummary } from "./record-service";
import { preciseTimestamp } from "./pagination";
import { AppError } from "./errors";

export function createPlaceHistoryService(db: Database) {
  async function history(
    actor: string | null,
    venueId: string,
    input: unknown = {},
  ): Promise<PlaceHistoryPage> {
    const value = placeHistoryQuerySchema.parse(input),
      id = uuidSchema.parse(venueId);
    return db.transaction(
      async (tx) => {
        const connection = tx as unknown as Database;
        const user = await requireRecordMember(connection, actor);
        if (!(await visibleRegisteredVenue(connection, user, id)))
          throw new AppError("NOT_FOUND", "장소를 찾을 수 없어요.");
        const venue = await eventMapService(connection).detail(user, id);
        // Only explicit selection plus its official completion snapshot establishes a usage case.
        const visible = and(
          eq(eventVenueLinks.venueId, id),
          recordVisible(user),
          sql`${eventRecords.snapshot}->'venue'->>'id'=${id}`,
        );
        const metrics = recordMetricProjection(user);
        const [stats] = await tx
          .select({
            completedEvents: sql<number>`count(*)::int`,
            attended: sql<number>`coalesce(sum(${metrics.attended}),0)::int`,
            qrAttended: sql<number>`coalesce(sum(${metrics.qrAttended}),0)::int`,
            managerAttended: sql<number>`coalesce(sum(${metrics.managerAttended}),0)::int`,
            tips: sql<number>`count(*) filter(where btrim(${eventRecords.venueTips})<>'')::int`,
          })
          .from(eventRecords)
          .innerJoin(eventVenueLinks, eq(eventVenueLinks.postId, eventRecords.postId))
          .where(visible);
        const search = "%" + value.q.replace(/[\\%_]/g, "\\$&") + "%";
        const filtered = and(
          visible,
          value.category ? sql`${eventRecords.snapshot}->>'category'=${value.category}` : undefined,
          value.tab === "tips" ? sql`btrim(${eventRecords.venueTips})<>''` : undefined,
          value.q
            ? or(
                ilike(sql`${eventRecords.snapshot}->>'title'`, search),
                ilike(eventRecords.venueTips, search),
              )
            : undefined,
        );
        const [totalRow] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(eventRecords)
          .innerJoin(eventVenueLinks, eq(eventVenueLinks.postId, eventRecords.postId))
          .where(filtered);
        const rows = await tx
          .select({
            record: {
              postId: eventRecords.postId,
              ownerId: eventRecords.ownerId,
              snapshot: eventRecords.snapshot,
              completedAt: eventRecords.completedAt,
              status: eventRecords.status,
            },
            updatedAt: preciseTimestamp(eventRecords.updatedAt),
            hostPublicId: profiles.publicId,
            hostNickname: profiles.nickname,
            canManage: sql<boolean>`false`,
            venueVisible: sql<boolean>`true`,
            venueTips: eventRecords.venueTips,
            ...metrics,
          })
          .from(eventRecords)
          .innerJoin(eventVenueLinks, eq(eventVenueLinks.postId, eventRecords.postId))
          .leftJoin(profiles, eq(profiles.id, eventRecords.ownerId))
          .where(filtered)
          .orderBy(desc(eventRecords.completedAt), desc(eventRecords.postId))
          .limit(20)
          .offset((value.page - 1) * 20);
        const total = Number(totalRow?.total ?? 0);
        return {
          venue,
          stats: {
            completedEvents: Number(stats?.completedEvents ?? 0),
            attended: Number(stats?.attended ?? 0),
            qrAttended: Number(stats?.qrAttended ?? 0),
            managerAttended: Number(stats?.managerAttended ?? 0),
            tips: Number(stats?.tips ?? 0),
          },
          items: rows.map((row) => ({
            record: recordSummary(row, user),
            venue: registeredVenueSnapshotSchema.parse(row.record.snapshot.venue),
            venueTips: row.venueTips,
          })),
          total,
          page: value.page,
          pageCount: Math.max(1, Math.ceil(total / 20)),
          hasMore: value.page * 20 < total,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  return { history };
}
export const placeHistoryService = createPlaceHistoryService;
