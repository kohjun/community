import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { profiles, eventRecords } from "../db/schema";
import { portfolioPreferences } from "../db/records-schema";
import { playerPreferences } from "../db/player-schema";
import { libraryEntries } from "../db/library-schema";
import {
  portfolioPreferenceSchema,
  portfolioQuerySchema,
  type PortfolioView,
  type PortfolioEvent,
  type PortfolioLibrary,
  type PortfolioSummary,
} from "../domain/portfolio";
import type { CreditRole } from "../domain/records";
import type { PlayerRole } from "../domain/player";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { requireRecordMember, recordVisible } from "./record-policy";
import { creditMemberVisible } from "./event-credit-service";
import { registeredVenueSnapshotVisible } from "./place-policy";
import { contentVisible } from "./safety-visibility";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = Database | Tx;
type Query = ReturnType<typeof portfolioQuerySchema.parse>;
const recordId = sql`"sliper"."event_records"."post_id"`;
type Target = {
  id: string;
  publicId: string;
  nickname: string;
  bio: string;
  region: string;
  avatar: string;
  visible: boolean | null;
  featuredEventIds: string[] | null;
  historyPublic: boolean | null;
};
const attended = (postId: unknown, user?: unknown) =>
  sql`exists(select 1 from sliper.event_results er join sliper.event_applications ea on ea.id=er.application_id and ea.post_id=er.post_id and ea.user_id=er.user_id where er.post_id=${postId} and er.presence='attended' ${user ? sql`and er.user_id=${user}::uuid` : sql``})`;
const host = (target: Target) =>
  sql`${eventRecords.snapshot}->>'hostPublicId'=${target.publicId} and ${attended(eventRecords.postId)}`;
const contribution = (target: Target) =>
  sql`exists(select 1 from sliper.event_credits ec where ec.post_id=${recordId} and ec.user_id=${target.id}::uuid and ec.status='accepted' and ec.confirmed_by is not null and ec.confirmed_by<>ec.user_id)`;
const eligible = (actor: string, target: Target) =>
  and(
    recordVisible(actor, false, true),
    sql`(${host(target)} or ${contribution(target)} or ${attended(eventRecords.postId, target.id)})`,
  )!;
async function targetProfile(
  connection: Connection,
  actor: string,
  publicId: string,
): Promise<Target> {
  const [target] = await connection
    .select({
      id: profiles.id,
      publicId: profiles.publicId,
      nickname: profiles.nickname,
      bio: profiles.bio,
      region: profiles.region,
      avatar: profiles.avatar,
      visible: portfolioPreferences.visible,
      featuredEventIds: portfolioPreferences.featuredEventIds,
      historyPublic: playerPreferences.historyPublic,
    })
    .from(profiles)
    .leftJoin(portfolioPreferences, eq(portfolioPreferences.userId, profiles.id))
    .leftJoin(playerPreferences, eq(playerPreferences.userId, profiles.id))
    .where(
      and(
        eq(profiles.publicId, uuidSchema.parse(publicId)),
        creditMemberVisible(actor, profiles.id),
      ),
    );
  if (!target) throw new AppError("NOT_FOUND", "플레이어를 찾을 수 없어요.");
  return target;
}
async function eventItems(
  connection: Connection,
  actor: string,
  target: Target,
  own: boolean,
  query: Query,
  featuredIds?: string[],
): Promise<PortfolioEvent[]> {
  const filter = and(
    eligible(actor, target),
    !own && !target.historyPublic ? sql`(${host(target)} or ${contribution(target)})` : undefined,
    featuredIds
      ? inArray(eventRecords.postId, featuredIds)
      : query.tab === "participation"
        ? attended(eventRecords.postId, target.id)
        : sql`(${host(target)} or ${contribution(target)})`,
    query.category ? sql`${eventRecords.snapshot}->>'category'=${query.category}` : undefined,
    query.year
      ? sql`extract(year from (${eventRecords.snapshot}->>'endsAt')::timestamptz at time zone 'Asia/Seoul')=${query.year}`
      : undefined,
    query.role === "주최자"
      ? host(target)
      : query.role
        ? sql`exists(select 1 from sliper.event_credits ec where ec.post_id=${recordId} and ec.user_id=${target.id}::uuid and ec.role=${query.role} and ec.status='accepted')`
        : undefined,
  );
  const rows = await connection
    .select({
      postId: eventRecords.postId,
      snapshot: eventRecords.snapshot,
      venueVisible: registeredVenueSnapshotVisible(actor, sql`"sliper"."event_records"."snapshot"`),
      status: eventRecords.status,
      roles: sql<
        CreditRole[]
      >`coalesce((select array_agg(ec.role order by ec.role) from sliper.event_credits ec where ec.post_id=${recordId} and ec.user_id=${target.id}::uuid and ec.status='accepted'),'{}'::varchar[])`,
      isHost: sql<boolean>`${host(target)}`,
      presence: sql<
        string | null
      >`(select er.presence from sliper.event_results er join sliper.event_applications ea on ea.id=er.application_id where er.post_id=${recordId} and er.user_id=${target.id}::uuid and er.presence='attended')`,
      outcome: sql<
        "participated" | "won" | null
      >`(select er.outcome from sliper.event_results er join sliper.event_applications ea on ea.id=er.application_id where er.post_id=${recordId} and er.user_id=${target.id}::uuid and er.presence='attended')`,
      observedRole: sql<PlayerRole | null>`(select er.observed_role from sliper.event_results er where er.post_id=${recordId} and er.user_id=${target.id}::uuid and er.presence='attended')`,
      qr: sql<boolean>`exists(select 1 from sliper.event_admissions ad where ad.post_id=${recordId} and ad.user_id=${target.id}::uuid)`,
    })
    .from(eventRecords)
    .where(filter)
    .orderBy(desc(eventRecords.completedAt), desc(eventRecords.postId))
    .limit(featuredIds ? 3 : 21)
    .offset(featuredIds ? 0 : (query.page - 1) * 20);
  const items: PortfolioEvent[] = rows.map((row) => ({
    kind: "event",
    postId: row.postId,
    title: row.snapshot.title,
    category: row.snapshot.category,
    location: row.snapshot.venue && !row.venueVisible ? "장소 정보 비공개" : row.snapshot.location,
    endsAt: row.snapshot.endsAt ?? "",
    recordPublished: row.status === "published",
    href: row.status === "published" ? "/records/" + row.postId : "/events/" + row.postId,
    roles: [...(row.isHost ? ["주최자" as const] : []), ...row.roles],
    participation:
      row.presence && (own || target.historyPublic)
        ? {
            evidence: row.qr ? "qr" : "manager",
            outcome: row.outcome ?? "participated",
            observedRole: row.observedRole,
          }
        : null,
  }));
  if (featuredIds)
    return items.sort((a, b) => featuredIds.indexOf(a.postId) - featuredIds.indexOf(b.postId));
  return items;
}
function safeLibrary(actor: string, target: Target) {
  return and(
    eq(libraryEntries.ownerId, target.id),
    eq(libraryEntries.status, "published"),
    eq(libraryEntries.sample, false),
    contentVisible("library", libraryEntries.id),
    creditMemberVisible(actor, libraryEntries.ownerId),
  )!;
}
async function libraryItems(
  connection: Connection,
  actor: string,
  target: Target,
  query: Query,
): Promise<PortfolioLibrary[]> {
  const rows = await connection
    .select({
      id: libraryEntries.id,
      kind: libraryEntries.kind,
      title: libraryEntries.title,
      category: libraryEntries.categorySlug,
      summary: libraryEntries.summary,
      priceKRW: libraryEntries.priceKRW,
      createdAt: libraryEntries.createdAt,
    })
    .from(libraryEntries)
    .where(
      and(
        safeLibrary(actor, target),
        query.category ? eq(libraryEntries.categorySlug, query.category) : undefined,
        query.year
          ? sql`extract(year from ${libraryEntries.createdAt} at time zone 'Asia/Seoul')=${query.year}`
          : undefined,
      ),
    )
    .orderBy(desc(libraryEntries.createdAt), desc(libraryEntries.id))
    .limit(21)
    .offset((query.page - 1) * 20);
  return rows.map((row) => ({
    ...row,
    kind: row.kind as "rulebook" | "template",
    createdAt: row.createdAt.toISOString(),
    href: `/archive/${row.id}`,
  }));
}
async function aggregate(
  connection: Connection,
  actor: string,
  target: Target,
): Promise<PortfolioSummary> {
  const visibility = recordVisible(actor, false, true);
  const counts = (condition: SQL) => sql<number>`count(*) filter(where ${condition})::int`;
  const [events] = await connection
    .select({
      participated: counts(attended(eventRecords.postId, target.id)),
      qrAttended: counts(
        sql`${attended(eventRecords.postId, target.id)} and exists(select 1 from sliper.event_admissions ad where ad.post_id=${recordId} and ad.user_id=${target.id}::uuid)`,
      ),
      managerAttended: counts(
        sql`${attended(eventRecords.postId, target.id)} and not exists(select 1 from sliper.event_admissions ad where ad.post_id=${recordId} and ad.user_id=${target.id}::uuid)`,
      ),
      wins: counts(
        sql`${attended(eventRecords.postId, target.id)} and exists(select 1 from sliper.event_results er where er.post_id=${recordId} and er.user_id=${target.id}::uuid and er.outcome='won')`,
      ),
      hosted: counts(host(target)),
      contributed: counts(contribution(target)),
      hostQrAttendeeCount: sql<number>`coalesce(sum(case when ${host(target)} then (select count(*) from sliper.event_results er where er.post_id=${recordId} and er.presence='attended' and exists(select 1 from sliper.event_admissions ad where ad.application_id=er.application_id)) else 0 end),0)::int`,
      hostManagerAttendeeCount: sql<number>`coalesce(sum(case when ${host(target)} then (select count(*) from sliper.event_results er where er.post_id=${recordId} and er.presence='attended' and not exists(select 1 from sliper.event_admissions ad where ad.application_id=er.application_id)) else 0 end),0)::int`,
      hostAttendeeCount: sql<number>`coalesce(sum(case when ${host(target)} then (select count(*) from sliper.event_results er join sliper.event_applications ea on ea.id=er.application_id where er.post_id=${recordId} and er.presence='attended') else 0 end),0)::int`,
    })
    .from(eventRecords)
    .where(visibility);
  const reviewEvidence = sql`${visibility} and ${host(target)} and rv.host_id=${target.id}::uuid and review.status='published' and not review.sample
    and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=review.id and cr.hidden)
    and exists(select 1 from sliper.event_results er join sliper.event_applications ea on ea.id=er.application_id where er.application_id=rv.application_id and er.presence='attended')
    and ${creditMemberVisible(actor, sql`rv.user_id`)}`;
  const [ratings] = await connection
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<number | null>`round(avg(rv.rating)::numeric,2)::float8`,
    })
    .from(eventRecords)
    .innerJoin(sql`sliper.verified_event_reviews rv`, sql`rv.event_post_id=${recordId}`)
    .innerJoin(sql`sliper.posts review`, sql`review.id=rv.review_post_id`)
    .where(reviewEvidence);
  const [libraries] = await connection
    .select({
      rulebooks: sql<number>`count(*) filter(where ${libraryEntries.kind}='rulebook')::int`,
      templates: sql<number>`count(*) filter(where ${libraryEntries.kind}='template')::int`,
    })
    .from(libraryEntries)
    .where(safeLibrary(actor, target));
  return {
    participated: Number(events?.participated ?? 0),
    qrAttended: Number(events?.qrAttended ?? 0),
    managerAttended: Number(events?.managerAttended ?? 0),
    wins: Number(events?.wins ?? 0),
    hosted: Number(events?.hosted ?? 0),
    contributed: Number(events?.contributed ?? 0),
    createdRulebooks: Number(libraries?.rulebooks ?? 0),
    createdTemplates: Number(libraries?.templates ?? 0),
    hostAttendeeCount: Number(events?.hostAttendeeCount ?? 0),
    hostQrAttendeeCount: Number(events?.hostQrAttendeeCount ?? 0),
    hostManagerAttendeeCount: Number(events?.hostManagerAttendeeCount ?? 0),
    hostReviewCount: Number(ratings?.count ?? 0),
    hostAverageRating:
      ratings?.average === null || ratings?.average === undefined ? null : Number(ratings.average),
  };
}
export function portfolioService(db: Database) {
  async function view(
    actor: string | null,
    publicId: string,
    input: unknown = {},
  ): Promise<PortfolioView> {
    const user = await requireRecordMember(db, actor),
      query = portfolioQuerySchema.parse(input);
    return db.transaction(
      async (tx) => {
        const target = await targetProfile(tx, user, publicId),
          own = target.id === user;
        if (!own && !target.visible) throw new AppError("NOT_FOUND", "공개된 포트폴리오가 없어요.");
        const historyVisible = own || !!target.historyPublic;
        const [summary, featured, entries] = await Promise.all([
          aggregate(tx, user, target),
          target.featuredEventIds?.length
            ? eventItems(
                tx,
                user,
                target,
                own,
                { tab: "creation", page: 1 },
                target.featuredEventIds,
              )
            : Promise.resolve([]),
          query.tab === "library"
            ? libraryItems(tx, user, target, query)
            : query.tab === "participation" && !historyVisible
              ? Promise.resolve([])
              : eventItems(tx, user, target, own, query),
        ]);
        return {
          publicId: target.publicId,
          nickname: target.nickname,
          bio: target.bio,
          region: target.region,
          avatar: target.avatar,
          isMe: own,
          visible: target.visible ?? false,
          historyVisible,
          featuredEventIds: own
            ? (target.featuredEventIds ?? [])
            : featured.map((item) => item.postId),
          featured,
          summary,
          query,
          items: entries.slice(0, 20),
          page: query.page,
          hasMore: entries.length > 20,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async function self(actor: string | null, input: unknown = {}) {
    const user = await requireRecordMember(db, actor);
    const [profile] = await db
      .select({ publicId: profiles.publicId })
      .from(profiles)
      .where(eq(profiles.id, user));
    if (!profile) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
    return view(user, profile.publicId, input);
  }
  async function updatePreference(actor: string | null, input: unknown) {
    const user = await requireRecordMember(db, actor),
      value = portfolioPreferenceSchema.parse(input);
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ publicId: profiles.publicId })
        .from(profiles)
        .where(eq(profiles.id, user))
        .for("update");
      if (!profile) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      const target = await targetProfile(tx, user, profile.publicId);
      if (value.featuredEventIds.length) {
        const eligibleItems = await eventItems(
          tx,
          user,
          target,
          true,
          { tab: "creation", page: 1 },
          value.featuredEventIds,
        );
        if (eligibleItems.length !== value.featuredEventIds.length)
          throw new AppError("VALIDATION", "확인된 완료 행사만 대표 행사로 선택할 수 있어요.");
      }
      await tx
        .insert(portfolioPreferences)
        .values({ userId: user, ...value })
        .onConflictDoUpdate({
          target: portfolioPreferences.userId,
          set: { ...value, updatedAt: sql`statement_timestamp()` },
        });
    });
    return self(user);
  }
  return { view, self, updatePreference };
}
