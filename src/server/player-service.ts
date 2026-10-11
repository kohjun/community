import { eventAdmissions } from "../db/event-operations-schema";
import { and, desc, eq, getTableColumns, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { profiles, posts, eventSettings, eventApplications, roomManagers } from "../db/schema";
import { eventResults, mannerReviews, playerPreferences } from "../db/player-schema";
import {
  eventResultSchema,
  mannerReviewSchema,
  playerDirectorySchema,
  playerPreferenceSchema,
  mannerTemperature,
  type PlayerRole,
  type PlayerSummary,
  type PlayerCard,
  type PlayerProfileView,
  type PlayerDirectoryView,
  type PlayerRosterView,
  type MannerReviewView,
} from "../domain/player";
import { AppError } from "./errors";
import { requireRecordMember } from "./record-policy";
import { creditMemberVisible } from "./event-credit-service";
import { authorVisible, contentVisible } from "./safety-visibility";
import { assertEventRunning, isEventCancelled } from "./event-lifecycle-service";
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
  pageScope,
  preciseTimestamp,
} from "./pagination";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const idSchema = z.uuid();
function summaryProjection(user: string | SQL) {
  const count = (condition: SQL) =>
    sql<number>`(select count(*)::int from sliper.event_results r join sliper.posts p on p.id=r.post_id where r.user_id=${user} and p.sample=false and ${condition})`;
  const reviews = (
    sentiment: string,
  ) => sql<number>`(select count(*)::int from sliper.manner_reviews m
    join sliper.event_results reviewer on reviewer.post_id=m.post_id and reviewer.user_id=m.reviewer_id
    join sliper.event_results target on target.post_id=m.post_id and target.user_id=m.target_id
    join sliper.posts p on p.id=m.post_id
    where p.sample=false and m.target_id=${user} and m.sentiment=${sentiment} and reviewer.presence='attended' and target.presence='attended')`;
  return {
    attended: count(sql`r.presence='attended'`),
    noShow: count(sql`r.presence='no_show'`),
    wins: count(sql`r.presence='attended' and r.outcome='won'`),
    hosted: sql<number>`(select count(distinct r.post_id)::int from sliper.event_results r join sliper.posts p on p.id=r.post_id join sliper.event_settings s on s.post_id=r.post_id where p.sample=false and p.author_id=${user} and r.presence='attended' and s.ends_at<=statement_timestamp())`,
    positive: reviews("positive"),
    negative: reviews("negative"),
    brain: count(sql`r.presence='attended' and r.observed_role='brain'`),
    physical: count(sql`r.presence='attended' and r.observed_role='physical'`),
    strategist: count(sql`r.presence='attended' and r.observed_role='strategist'`),
    trickster: count(sql`r.presence='attended' and r.observed_role='trickster'`),
  };
}
type SummaryRow = {
  attended: number;
  noShow: number;
  wins: number;
  hosted: number;
  positive: number;
  negative: number;
  brain: number;
  physical: number;
  strategist: number;
  trickster: number;
};
function summary(row: SummaryRow): PlayerSummary {
  return {
    attended: row.attended,
    noShow: row.noShow,
    wins: row.wins,
    hosted: row.hosted,
    positive: row.positive,
    negative: row.negative,
    mannerTemperature: mannerTemperature(row),
    observedRoles: {
      brain: row.brain,
      physical: row.physical,
      strategist: row.strategist,
      trickster: row.trickster,
    },
  };
}
const cardProjection = {
  publicId: profiles.publicId,
  nickname: profiles.nickname,
  bio: profiles.bio,
  region: profiles.region,
  avatar: profiles.avatar,
  preferredRole: playerPreferences.preferredRole,
  ...summaryProjection(sql`${profiles.id}`),
};
function card(
  row: {
    publicId: string;
    nickname: string;
    bio: string;
    region: string;
    avatar: string;
    preferredRole: string | null;
  } & SummaryRow,
  careerVisible = true,
): PlayerCard {
  return {
    publicId: row.publicId,
    nickname: row.nickname,
    bio: row.bio,
    region: row.region,
    avatar: row.avatar,
    preferredRole: row.preferredRole as PlayerRole | null,
    summary: careerVisible
      ? summary(row)
      : {
          ...summary(row),
          attended: 0,
          wins: 0,
          hosted: 0,
          observedRoles: { brain: 0, physical: 0, strategist: 0, trickster: 0 },
        },
    careerVisible,
  };
}
export function playerService(db: Database, clock = () => new Date()) {
  async function lockEvent(tx: Tx, postId: string, actor: string, managerRequired: boolean) {
    const [post] = await tx
      .select()
      .from(posts)
      .where(eq(posts.id, idSchema.parse(postId)))
      .for("update");
    if (!post || post.kind !== "모집" || post.status !== "published")
      throw new AppError("NOT_FOUND", "행사를 찾을 수 없어요.");
    if (managerRequired && post.authorId !== actor) {
      const [manager] = await tx
        .select({ userId: roomManagers.userId })
        .from(roomManagers)
        .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, actor)));
      if (!manager) throw new AppError("FORBIDDEN", "행사 담당자만 참가 전적을 기록할 수 있어요.");
    }
    const [settings] = await tx
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId));
    const ended = Boolean(settings?.endsAt && settings.endsAt.getTime() <= clock().getTime());
    return { post, settings, ended };
  }
  async function profile(actor: string | null, publicId: string): Promise<PlayerProfileView> {
    const member = await requireRecordMember(db, actor);
    const [row] = await db
      .select({
        ...cardProjection,
        matchingVisible: playerPreferences.matchingVisible,
        historyPublic: playerPreferences.historyPublic,
        isMe: actor ? sql<boolean>`${profiles.id}=${actor}::uuid` : sql<boolean>`false`,
      })
      .from(profiles)
      .leftJoin(playerPreferences, eq(playerPreferences.userId, profiles.id))
      .where(
        and(
          eq(profiles.publicId, idSchema.parse(publicId)),
          creditMemberVisible(member, profiles.id),
        ),
      );
    if (!row) throw new AppError("NOT_FOUND", "플레이어를 찾을 수 없어요.");
    const history =
      row.isMe || row.historyPublic
        ? await db
            .select({
              postId: eventResults.postId,
              title: sql<string>`case when ${posts.status}='published' then ${posts.title} else '종료된 행사' end`,
              endedAt: eventSettings.endsAt,
              sample: posts.sample,
              presence: eventResults.presence,
              outcome: eventResults.outcome,
              observedRole: eventResults.observedRole,
            })
            .from(eventResults)
            .innerJoin(profiles, eq(profiles.id, eventResults.userId))
            .innerJoin(posts, eq(posts.id, eventResults.postId))
            .innerJoin(eventSettings, eq(eventSettings.postId, eventResults.postId))
            .where(
              and(
                eq(profiles.publicId, publicId),
                eq(posts.status, "published"),
                contentVisible("post", posts.id),
                authorVisible(posts.authorId, member),
              ),
            )
            .orderBy(desc(eventSettings.endsAt), desc(eventResults.postId))
            .limit(30)
        : [];
    return {
      ...card(row, row.isMe || !!row.historyPublic),
      isMe: row.isMe,
      matchingVisible: row.matchingVisible ?? false,
      historyPublic: row.historyPublic ?? false,
      history: history.map((value) => ({
        postId: value.postId,
        title: value.title,
        endedAt: value.endedAt!.toISOString(),
        sample: value.sample,
        presence: value.presence as "attended" | "no_show",
        outcome: value.outcome as "participated" | "won",
        observedRole: value.observedRole as PlayerRole | null,
      })),
    };
  }
  async function self(actor: string | null) {
    const user = await requireRecordMember(db, actor);
    const [row] = await db
      .select({ publicId: profiles.publicId })
      .from(profiles)
      .where(eq(profiles.id, user));
    if (!row) throw new AppError("NOT_FOUND", "프로필을 먼저 만들어주세요.");
    return profile(user, row.publicId);
  }
  async function updatePreference(actor: string | null, input: unknown) {
    const user = await requireRecordMember(db, actor),
      value = playerPreferenceSchema.parse(input);
    const [row] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, user));
    if (!row) throw new AppError("NOT_FOUND", "프로필을 찾을 수 없어요.");
    await db
      .insert(playerPreferences)
      .values({ userId: user, ...value })
      .onConflictDoUpdate({
        target: playerPreferences.userId,
        set: { ...value, updatedAt: sql`statement_timestamp()` },
      });
    return self(user);
  }
  async function directory(
    actor: string | null,
    input: unknown = {},
  ): Promise<PlayerDirectoryView> {
    const member = await requireRecordMember(db, actor);
    const query = playerDirectorySchema.parse(input),
      scope = pageScope(["players", query.role ?? null, query.region ?? null]),
      cursor = decodeCursor(query.cursor, scope);
    const rows = await db
      .select({
        ...cardProjection,
        historyPublic: playerPreferences.historyPublic,
        isMe: sql<boolean>`${profiles.id}=${member}::uuid`,
        createdAt: preciseTimestamp(profiles.createdAt),
        id: profiles.publicId,
      })
      .from(profiles)
      .innerJoin(playerPreferences, eq(playerPreferences.userId, profiles.id))
      .where(
        and(
          eq(playerPreferences.matchingVisible, true),
          creditMemberVisible(member, profiles.id),
          query.role ? eq(playerPreferences.preferredRole, query.role) : undefined,
          query.region
            ? ilike(profiles.region, `%${query.region.replace(/[\\%_]/g, "\\$&")}%`)
            : undefined,
          cursor ? afterPosition(profiles.createdAt, profiles.publicId, cursor, "desc") : undefined,
        ),
      )
      .orderBy(desc(profiles.createdAt), desc(profiles.publicId))
      .limit(21);
    const visible = rows.slice(0, 20),
      last = visible.at(-1);
    const [me] = actor
      ? await db
          .select({ publicId: profiles.publicId })
          .from(profiles)
          .where(eq(profiles.id, actor))
      : [];
    return {
      items: visible.map((row) => card(row, row.isMe || !!row.historyPublic)),
      nextCursor: rows.length > 20 && last ? encodeCursor(scope, last) : null,
      myPublicId: me?.publicId ?? null,
    };
  }
  async function recordRoster(actor: string | null, postId: string): Promise<PlayerRosterView> {
    const user = await requireRecordMember(db, actor);
    return db.transaction(async (tx) => {
      const { post, settings, ended } = await lockEvent(tx, postId, user, true);
      const cancelled = await isEventCancelled(tx, postId);
      const members = await tx
        .select({
          applicationId: eventApplications.id,
          publicId: profiles.publicId,
          nickname: profiles.nickname,
          isMe: sql<boolean>`${profiles.id}=${user}::uuid`,
          presence: eventResults.presence,
          outcome: eventResults.outcome,
          observedRole: eventResults.observedRole,
          reason: eventResults.reason,
          resultUpdatedAt: preciseTimestamp(eventResults.updatedAt),
        })
        .from(eventApplications)
        .innerJoin(profiles, eq(profiles.id, eventApplications.userId))
        .leftJoin(
          eventResults,
          and(
            eq(eventResults.postId, eventApplications.postId),
            eq(eventResults.userId, eventApplications.userId),
          ),
        )
        .where(and(eq(eventApplications.postId, postId), eq(eventApplications.status, "confirmed")))
        .orderBy(profiles.nickname, eventApplications.id)
        .limit(5000);
      return {
        postId,
        title: post.title,
        canRecord: ended && !cancelled,
        endedAt: settings?.endsAt?.toISOString() ?? null,
        attendees: members.map((m) => ({
          applicationId: m.applicationId,
          publicId: m.publicId,
          nickname: m.nickname,
          isMe: m.isMe,
          result: m.presence
            ? {
                presence: m.presence as "attended" | "no_show",
                outcome: m.outcome as "participated" | "won",
                observedRole: m.observedRole as PlayerRole | null,
                reason: m.reason!,
                updatedAt: m.resultUpdatedAt!,
              }
            : null,
        })),
      };
    });
  }
  async function recordResult(actor: string | null, postId: string, input: unknown) {
    const user = await requireRecordMember(db, actor),
      value = eventResultSchema.parse(input);
    await db.transaction(async (tx) => {
      const { ended } = await lockEvent(tx, postId, user, true);
      await assertEventRunning(tx, postId);
      if (!ended)
        throw new AppError("CONFLICT", "정확한 종료 시각을 설정하고 행사가 끝난 뒤 기록해주세요.");
      const [application] = await tx
        .select()
        .from(eventApplications)
        .where(
          and(eq(eventApplications.id, value.applicationId), eq(eventApplications.postId, postId)),
        )
        .for("update");
      if (!application || application.status !== "confirmed")
        throw new AppError("CONFLICT", "참가가 확정된 플레이어에게만 전적을 기록할 수 있어요.");
      if (application.userId === user)
        throw new AppError("FORBIDDEN", "자신의 전적은 다른 행사 담당자가 확인해야 해요.");
      const [admission] = await tx
        .select({ id: eventAdmissions.applicationId })
        .from(eventAdmissions)
        .where(eq(eventAdmissions.applicationId, application.id));
      if (admission && value.presence === "no_show")
        throw new AppError("CONFLICT", "QR 입장을 확인한 참가자는 미참석으로 기록할 수 없어요.");
      const [existing] = await tx
        .select({
          ...getTableColumns(eventResults),
          exactUpdatedAt: preciseTimestamp(eventResults.updatedAt),
        })
        .from(eventResults)
        .where(and(eq(eventResults.postId, postId), eq(eventResults.userId, application.userId)));
      const changed =
        existing &&
        (existing.presence !== value.presence ||
          existing.outcome !== value.outcome ||
          existing.observedRole !== value.observedRole);
      if (existing && !changed && !value.reason) return;
      if (
        existing &&
        (!value.expectedUpdatedAt || existing.exactUpdatedAt !== value.expectedUpdatedAt)
      )
        throw new AppError(
          "CONFLICT",
          "전적이 변경되었어요. 최신 참가 전적을 불러온 뒤 다시 수정해주세요.",
        );
      if (changed && !value.reason)
        throw new AppError("VALIDATION", "참가 전적을 수정하는 이유를 적어주세요.");
      await tx
        .insert(eventResults)
        .values({ ...value, postId, userId: application.userId, recorderId: user })
        .onConflictDoUpdate({
          target: [eventResults.postId, eventResults.userId],
          set: {
            ...value,
            recorderId: user,
            updatedAt: sql`greatest(statement_timestamp(), ${eventResults.updatedAt} + interval '1 millisecond')`,
          },
        });
    });
    return recordRoster(user, postId);
  }
  async function reviewable(actor: string | null, postId: string): Promise<MannerReviewView> {
    const user = await requireRecordMember(db, actor);
    return db.transaction(async (tx) => {
      const { post, ended } = await lockEvent(tx, postId, user, false);
      await assertEventRunning(tx, postId);
      const [own] = await tx
        .select({ presence: eventResults.presence })
        .from(eventResults)
        .where(and(eq(eventResults.postId, postId), eq(eventResults.userId, user)));
      if (!ended || own?.presence !== "attended")
        throw new AppError(
          "FORBIDDEN",
          "행사 종료 후 실제 참가가 확인된 플레이어만 서로 평가할 수 있어요.",
        );
      const members = await tx
        .select({
          publicId: profiles.publicId,
          nickname: profiles.nickname,
          reviewed: sql<boolean>`exists(select 1 from sliper.manner_reviews m where m.post_id=${postId}::uuid and m.reviewer_id=${user}::uuid and m.target_id=${profiles.id})`,
        })
        .from(eventResults)
        .innerJoin(profiles, eq(profiles.id, eventResults.userId))
        .where(
          and(
            eq(eventResults.postId, postId),
            eq(eventResults.presence, "attended"),
            sql`${eventResults.userId}<>${user}::uuid`,
          ),
        )
        .orderBy(profiles.nickname)
        .limit(5000);
      return { postId, title: post.title, members };
    });
  }
  async function reviewManner(actor: string | null, postId: string, input: unknown) {
    const user = await requireRecordMember(db, actor),
      value = mannerReviewSchema.parse(input);
    await db.transaction(async (tx) => {
      const { ended } = await lockEvent(tx, postId, user, false);
      await assertEventRunning(tx, postId);
      if (!ended) throw new AppError("CONFLICT", "행사가 끝난 뒤 평가할 수 있어요.");
      const [target] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.publicId, value.targetPublicId));
      if (!target) throw new AppError("NOT_FOUND", "플레이어를 찾을 수 없어요.");
      if (target.id === user)
        throw new AppError("FORBIDDEN", "자신에게 매너 평가를 남길 수 없어요.");
      const participants = await tx
        .select({ userId: eventResults.userId, presence: eventResults.presence })
        .from(eventResults)
        .where(
          and(
            eq(eventResults.postId, postId),
            sql`${eventResults.userId} in (${user}::uuid, ${target.id}::uuid)`,
          ),
        );
      if (participants.length !== 2 || participants.some((p) => p.presence !== "attended"))
        throw new AppError(
          "FORBIDDEN",
          "같은 행사에 실제로 참가한 플레이어끼리만 평가할 수 있어요.",
        );
      const [existing] = await tx
        .select()
        .from(mannerReviews)
        .where(
          and(
            eq(mannerReviews.postId, postId),
            eq(mannerReviews.reviewerId, user),
            eq(mannerReviews.targetId, target.id),
          ),
        );
      const tags = [...value.tags].sort();
      if (existing) {
        if (
          existing.sentiment === value.sentiment &&
          JSON.stringify([...existing.tags].sort()) === JSON.stringify(tags)
        )
          return;
        throw new AppError("CONFLICT", "한 행사에서 같은 플레이어에게는 한 번만 평가할 수 있어요.");
      }
      await tx.insert(mannerReviews).values({
        postId,
        reviewerId: user,
        targetId: target.id,
        sentiment: value.sentiment,
        tags,
      });
    });
    return reviewable(user, postId);
  }
  return {
    profile,
    self,
    directory,
    updatePreference,
    recordRoster,
    recordResult,
    reviewable,
    reviewManner,
  };
}
