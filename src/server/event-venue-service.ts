import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventApplications, eventSettings, posts } from "../db/schema";
import { communityVenues, eventVenueLinks } from "../db/venue-schema";
import { venueSchema, type VenuePoint } from "../domain/discovery";
import {
  registeredVenueSnapshotSchema,
  type RegisteredVenueSnapshot,
} from "../domain/place-snapshot";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { registeredVenueVisible } from "./place-policy";
import { requireRecordMember } from "./record-policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Transaction;
type VenueCoordinates = {
  venueLatitude: number | null;
  venueLongitude: number | null;
};

// Safe navigation references expose only a currently accessible source, never its contributor.
export function visibleEventVenueId(actor: string | null, postId: unknown): SQL<string | null> {
  return sql<string | null>`(select ${eventVenueLinks.venueId}::text from ${eventVenueLinks}
    join ${communityVenues} on ${communityVenues.id}=${eventVenueLinks.venueId}
    where ${eventVenueLinks.postId}=${postId} and ${registeredVenueVisible(actor)})`;
}
export function visibleEventVenueVersion(
  actor: string | null,
  postId: unknown,
): SQL<number | null> {
  return sql<
    number | null
  >`(select (${eventVenueLinks.snapshot}->>'version')::integer from ${eventVenueLinks}
    join ${communityVenues} on ${communityVenues.id}=${eventVenueLinks.venueId}
    where ${eventVenueLinks.postId}=${postId} and ${registeredVenueVisible(actor)})`;
}
export async function readEventVenueReference(
  connection: Connection,
  actor: string | null,
  postId: string,
): Promise<Pick<VenuePoint, "communityVenueId" | "communityVenueVersion">> {
  const [row] = await connection
    .select({
      id: visibleEventVenueId(actor, postId),
      version: visibleEventVenueVersion(actor, postId),
    })
    .from(eventVenueLinks)
    .where(eq(eventVenueLinks.postId, postId));
  return row?.id && row.version
    ? { communityVenueId: row.id, communityVenueVersion: row.version }
    : {};
}

// Internal completion code copies the selection snapshot without consulting mutable place facts.
export async function readEventVenueSnapshot(
  connection: Connection,
  postId: string,
): Promise<RegisteredVenueSnapshot | null> {
  const [row] = await connection
    .select({ snapshot: eventVenueLinks.snapshot })
    .from(eventVenueLinks)
    .where(eq(eventVenueLinks.postId, postId));
  return row ? registeredVenueSnapshotSchema.parse(row.snapshot) : null;
}

/** Callers retain the event lock until their settings write completes in the same transaction. */
export async function bindEventVenue(
  tx: Transaction,
  actor: string,
  postId: string,
  venueInput: VenuePoint | null | undefined,
): Promise<VenueCoordinates> {
  // Use the same lock order as event completion: post, settings, then the shared source row.
  const [post] = await tx
    .select({ id: posts.id, kind: posts.kind, status: posts.status })
    .from(posts)
    .where(eq(posts.id, uuidSchema.parse(postId)))
    .for("update");
  if (!post || post.kind !== "모집" || post.status !== "published")
    throw new AppError("NOT_FOUND", "모집글을 찾을 수 없어요.");
  const [settings] = await tx
    .select()
    .from(eventSettings)
    .where(eq(eventSettings.postId, postId))
    .for("update");
  const previous: VenueCoordinates = {
    venueLatitude: settings?.venueLatitude ?? null,
    venueLongitude: settings?.venueLongitude ?? null,
  };
  if (venueInput === undefined) return previous;
  const input = venueInput === null ? null : venueSchema.parse(venueInput);
  const [existing] = await tx
    .select()
    .from(eventVenueLinks)
    .where(eq(eventVenueLinks.postId, postId))
    .for("update");
  let point: VenueCoordinates = {
    venueLatitude: input?.latitude ?? null,
    venueLongitude: input?.longitude ?? null,
  };
  let snapshot: RegisteredVenueSnapshot | null = null;
  let preserve = false;
  if (input?.communityVenueId) {
    await requireRecordMember(tx as unknown as Database, actor);
    const venueId = uuidSchema.parse(input.communityVenueId);
    const [venue] = await tx
      .select()
      .from(communityVenues)
      .where(and(eq(communityVenues.id, venueId), registeredVenueVisible(actor)))
      .for("share");
    if (!venue) throw new AppError("NOT_FOUND", "선택한 등록 장소를 이용할 수 없어요.");
    preserve = !!(
      existing &&
      existing.venueId === venueId &&
      existing.snapshot.latitude === input.latitude &&
      existing.snapshot.longitude === input.longitude &&
      (input.communityVenueVersion === undefined ||
        input.communityVenueVersion === existing.snapshot.version)
    );
    if (preserve) {
      point = {
        venueLatitude: existing!.snapshot.latitude,
        venueLongitude: existing!.snapshot.longitude,
      };
    } else {
      if (input.latitude !== venue.latitude || input.longitude !== venue.longitude)
        throw new AppError(
          "VALIDATION",
          "선택한 등록 장소의 위치가 변경됐어요. 장소를 다시 선택해주세요.",
        );
      if (
        input.communityVenueVersion !== undefined &&
        input.communityVenueVersion !== venue.version
      )
        throw new AppError(
          "CONFLICT",
          "선택한 등록 장소 정보가 변경됐어요. 장소를 다시 선택해주세요.",
        );
      snapshot = registeredVenueSnapshotSchema.parse({
        id: venue.id,
        name: venue.name,
        address: venue.address,
        latitude: venue.latitude,
        longitude: venue.longitude,
        categorySlug: venue.categorySlug,
        spaceType: venue.spaceType,
        isFree: venue.isFree,
        feeNote: venue.feeNote,
        capacity: venue.capacity,
        version: venue.version,
        capturedAt: new Date().toISOString(),
      });
      point = { venueLatitude: venue.latitude, venueLongitude: venue.longitude };
    }
  }
  const changed =
    point.venueLatitude !== previous.venueLatitude ||
    point.venueLongitude !== previous.venueLongitude ||
    (existing?.venueId ?? null) !== (snapshot?.id ?? (preserve ? existing!.venueId : null)) ||
    (!!snapshot && !!existing);
  if (changed && settings?.completedAt)
    throw new AppError("CONFLICT", "완료된 행사의 등록 장소와 위치는 변경할 수 없어요.");
  if (changed && settings?.venueLatitude !== null && settings?.venueLatitude !== undefined) {
    const [application] = await tx
      .select({ id: eventApplications.id })
      .from(eventApplications)
      .where(eq(eventApplications.postId, postId))
      .limit(1);
    if (application)
      throw new AppError("CONFLICT", "참가 내역이 있는 행사의 장소와 위치는 변경할 수 없어요.");
  }
  if (preserve) return point;
  if (snapshot)
    await tx
      .insert(eventVenueLinks)
      .values({ postId, venueId: snapshot.id, snapshot })
      .onConflictDoUpdate({
        target: eventVenueLinks.postId,
        set: { venueId: snapshot.id, snapshot },
      });
  else if (existing) await tx.delete(eventVenueLinks).where(eq(eventVenueLinks.postId, postId));
  return point;
}
