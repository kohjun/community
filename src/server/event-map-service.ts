import { and, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventSettings, posts, profiles } from "../db/schema";
import { communityVenues, venueRecommendations } from "../db/venue-schema";
import {
  EVENT_MAP_CATEGORIES,
  EVENT_MAP_PIN_LIMIT,
  eventMapQuerySchema,
  venueDeleteSchema,
  venueInputSchema,
  venueRecommendationSchema,
  venueUpdateSchema,
  type CommunityVenue,
  type EventMapSnapshot,
  type MapEvent,
} from "../domain/event-map";
import { uuidSchema } from "../domain/validation";
import { AppError, requireActor } from "./errors";
import { registeredVenueVisible } from "./place-policy";
import { contentVisible, authorVisible } from "./safety-visibility";
import { eventAvailable } from "./post-reader";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Transaction;
type Venue = typeof communityVenues.$inferSelect;

export function eventMapService(db: Database) {
  function selectVenues(connection: Connection, actor: string | null) {
    return connection
      .select({
        venue: communityVenues,
        contributorName: profiles.nickname,
        contributorPublicId: profiles.publicId,
        contributorAvatar: profiles.avatar,
        recommendations: sql<number>`(select count(*)::int from ${venueRecommendations} where ${venueRecommendations.venueId}=${communityVenues.id})`,
        recommended: actor
          ? sql<boolean>`exists(select 1 from ${venueRecommendations} where ${venueRecommendations.venueId}=${communityVenues.id} and ${venueRecommendations.userId}=${actor}::uuid)`
          : sql<boolean>`false`,
      })
      .from(communityVenues)
      .leftJoin(profiles, eq(profiles.id, communityVenues.ownerId));
  }
  type VenueRow = Awaited<ReturnType<typeof selectVenues>>[number];
  function publicVenue(row: VenueRow, actor: string | null): CommunityVenue {
    const venue = row.venue;
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      description: venue.description,
      latitude: venue.latitude,
      longitude: venue.longitude,
      categorySlug: venue.categorySlug as CommunityVenue["categorySlug"],
      spaceType: venue.spaceType as CommunityVenue["spaceType"],
      isFree: venue.isFree,
      feeNote: venue.feeNote,
      capacity: venue.capacity,
      tags: venue.tags,
      websiteUrl: venue.websiteUrl,
      contributor:
        row.contributorPublicId && row.contributorName
          ? {
              nickname: row.contributorName,
              publicId: row.contributorPublicId,
              avatar: row.contributorAvatar ?? "spark",
            }
          : null,
      isOwner: !!actor && venue.ownerId === actor,
      recommendations: Number(row.recommendations),
      recommended: row.recommended,
      version: venue.version,
      createdAt: venue.createdAt.toISOString(),
      updatedAt: venue.updatedAt.toISOString(),
    };
  }
  async function detailOn(
    connection: Connection,
    actor: string | null,
    id: string,
  ): Promise<CommunityVenue> {
    const [row] = await selectVenues(connection, actor).where(
      and(eq(communityVenues.id, uuidSchema.parse(id)), registeredVenueVisible(actor)),
    );
    if (!row) throw new AppError("NOT_FOUND", "장소를 찾을 수 없어요.");
    return publicVenue(row, actor);
  }
  async function locked(tx: Transaction, id: string): Promise<Venue> {
    const [venue] = await tx
      .select()
      .from(communityVenues)
      .where(
        and(
          eq(communityVenues.id, uuidSchema.parse(id)),
          contentVisible("venue", communityVenues.id),
        ),
      )
      .for("update");
    if (!venue || venue.status !== "published")
      throw new AppError("NOT_FOUND", "장소를 찾을 수 없어요.");
    return venue;
  }
  async function owned(tx: Transaction, actor: string, id: string, version: number) {
    const venue = await locked(tx, id);
    if (venue.ownerId !== actor)
      throw new AppError("FORBIDDEN", "등록한 회원만 장소를 수정할 수 있어요.");
    if (venue.version !== version)
      throw new AppError("CONFLICT", "장소 정보가 변경됐어요. 새로고침 후 다시 시도해주세요.");
    return venue;
  }
  return {
    async list(actor: string | null, input: unknown = {}): Promise<EventMapSnapshot> {
      const value = eventMapQuerySchema.parse(input),
        search = `%${value.q.replace(/[\\%_]/g, "\\$&")}%`;
      const venueFilter = and(
        registeredVenueVisible(actor),
        value.category !== "all" ? eq(communityVenues.categorySlug, value.category) : undefined,
        value.freeOnly ? eq(communityVenues.isFree, true) : undefined,
        value.q
          ? or(
              ilike(communityVenues.name, search),
              ilike(communityVenues.address, search),
              ilike(communityVenues.description, search),
              sql`${communityVenues.tags}::text ilike ${search}`,
            )
          : undefined,
        value.south !== undefined
          ? and(
              gte(communityVenues.latitude, value.south),
              lte(communityVenues.latitude, value.north!),
              gte(communityVenues.longitude, value.west!),
              lte(communityVenues.longitude, value.east!),
            )
          : undefined,
      );
      const eventFilter = and(
        eq(posts.status, "published"),
        sql`not exists(select 1 from sliper.event_lifecycle lifecycle where lifecycle.post_id=${posts.id} and lifecycle.cancelled_at is not null)`,
        contentVisible("post", posts.id),
        authorVisible(posts.authorId, actor),
        eq(posts.kind, "모집"),
        eq(posts.sample, false),
        inArray(posts.categorySlug, [...EVENT_MAP_CATEGORIES]),
        isNotNull(eventSettings.venueLatitude),
        isNotNull(eventSettings.venueLongitude),
        sql`case when ${eventSettings.endsAt} is not null then ${eventSettings.endsAt}>statement_timestamp() when ${eventSettings.startsAt} is not null then ${eventSettings.startsAt}>statement_timestamp() else true end`,
        value.category !== "all" ? eq(posts.categorySlug, value.category) : undefined,
        value.freeOnly ? eq(eventSettings.amountKRW, 0) : undefined,
        value.q ? or(ilike(posts.title, search), ilike(posts.location, search)) : undefined,
        value.south !== undefined
          ? and(
              gte(eventSettings.venueLatitude, value.south),
              lte(eventSettings.venueLatitude, value.north!),
              gte(eventSettings.venueLongitude, value.west!),
              lte(eventSettings.venueLongitude, value.east!),
            )
          : undefined,
      );
      return db.transaction(
        async (tx) => {
          const [venueCount] =
            value.mode !== "event"
              ? await tx
                  .select({ value: sql<number>`count(*)::int` })
                  .from(communityVenues)
                  .where(venueFilter)
              : [];
          const [eventCount] =
            value.mode !== "place"
              ? await tx
                  .select({ value: sql<number>`count(*)::int` })
                  .from(posts)
                  .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
                  .where(eventFilter)
              : [];
          const totalVenues = Number(venueCount?.value ?? 0),
            totalEvents = Number(eventCount?.value ?? 0);
          const venueLimit =
            totalEvents === 0
              ? EVENT_MAP_PIN_LIMIT
              : Math.min(
                  totalVenues,
                  Math.max(
                    EVENT_MAP_PIN_LIMIT / 2,
                    EVENT_MAP_PIN_LIMIT - Math.min(totalEvents, EVENT_MAP_PIN_LIMIT / 2),
                  ),
                );
          const venueRows = totalVenues
            ? await selectVenues(tx, actor)
                .where(venueFilter)
                .orderBy(desc(communityVenues.createdAt), desc(communityVenues.id))
                .limit(venueLimit)
            : [];
          const eventLimit = EVENT_MAP_PIN_LIMIT - venueRows.length;
          const eventRows =
            totalEvents && eventLimit
              ? await tx
                  .select({
                    id: posts.id,
                    title: posts.title,
                    location: posts.location,
                    latitude: eventSettings.venueLatitude,
                    longitude: eventSettings.venueLongitude,
                    categorySlug: posts.categorySlug,
                    meetupType: eventSettings.meetupType,
                    startsAt: eventSettings.startsAt,
                    amountKRW: eventSettings.amountKRW,
                    capacity: eventSettings.capacity,
                    open: eventAvailable,
                  })
                  .from(posts)
                  .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
                  .where(eventFilter)
                  .orderBy(desc(posts.createdAt), desc(posts.id))
                  .limit(eventLimit)
              : [];
          const events: MapEvent[] = eventRows.map((row) => ({
            id: row.id,
            title: row.title,
            location: row.location ?? "장소 확인",
            latitude: row.latitude!,
            longitude: row.longitude!,
            categorySlug: row.categorySlug as MapEvent["categorySlug"],
            meetupType: row.meetupType as MapEvent["meetupType"],
            startsAt: row.startsAt?.toISOString() ?? null,
            amountKRW: row.amountKRW,
            capacity: row.capacity,
            open: row.open,
          }));
          return {
            venues: venueRows.map((row) => publicVenue(row, actor)),
            events,
            totalVenues,
            totalEvents,
            truncated: totalVenues + totalEvents > venueRows.length + events.length,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async detail(actor: string | null, id: string) {
      return detailOn(db, actor, id);
    },
    async create(actor: string | null, input: unknown) {
      const user = requireActor(actor),
        value = venueInputSchema.parse(input);
      return db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, user))
          .for("update");
        if (!profile) throw new AppError("UNAUTHENTICATED", "로그인 정보를 확인해주세요.");
        const [recent] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(communityVenues)
          .where(
            and(
              eq(communityVenues.ownerId, user),
              sql`${communityVenues.createdAt}>statement_timestamp()-interval '24 hours'`,
            ),
          );
        if (Number(recent?.value ?? 0) >= 50)
          throw new AppError(
            "RATE_LIMITED",
            "하루에 등록할 수 있는 장소 수를 넘었어요. 내일 다시 시도해주세요.",
          );
        const [venue] = await tx
          .insert(communityVenues)
          .values({ ...value, ownerId: user })
          .returning({ id: communityVenues.id });
        return detailOn(tx, user, venue!.id);
      });
    },
    async update(actor: string | null, id: string, input: unknown) {
      const user = requireActor(actor),
        { version, ...value } = venueUpdateSchema.parse(input);
      return db.transaction(async (tx) => {
        const venue = await owned(tx, user, id, version);
        await tx
          .update(communityVenues)
          .set({ ...value, version: venue.version + 1, updatedAt: new Date() })
          .where(eq(communityVenues.id, venue.id));
        return detailOn(tx, user, venue.id);
      });
    },
    async remove(actor: string | null, id: string, input: unknown) {
      const user = requireActor(actor),
        value = venueDeleteSchema.parse(input);
      return db.transaction(async (tx) => {
        const venue = await owned(tx, user, id, value.version);
        await tx
          .update(communityVenues)
          .set({
            status: "deleted",
            deletedAt: new Date(),
            version: venue.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(communityVenues.id, venue.id));
        return { id: venue.id };
      });
    },
    async recommend(actor: string | null, id: string, input: unknown) {
      const user = requireActor(actor),
        value = venueRecommendationSchema.parse(input);
      return db.transaction(async (tx) => {
        const venue = await locked(tx, id);
        if (value.liked)
          await tx
            .insert(venueRecommendations)
            .values({ venueId: venue.id, userId: user })
            .onConflictDoNothing();
        else
          await tx
            .delete(venueRecommendations)
            .where(
              and(
                eq(venueRecommendations.venueId, venue.id),
                eq(venueRecommendations.userId, user),
              ),
            );
        return detailOn(tx, user, venue.id);
      });
    },
  };
}
