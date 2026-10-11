import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import {
  crews,
  crewMembers,
  crewJoinRequests,
  crewEvents,
  crewActivity,
  crewContributions,
} from "../db/crew-schema";
import { profiles, posts, eventSettings, roomManagers } from "../db/schema";
import { eventResults } from "../db/player-schema";
import { eventAdmissions } from "../db/event-operations-schema";
import { memberSafety } from "../db/safety-schema";
import { eventLifecycle } from "../db/event-lifecycle-schema";
import {
  crewInputSchema,
  crewUpdateSchema,
  crewJoinSchema,
  crewDecisionSchema,
  crewRoleSchema,
  crewTargetSchema,
  crewAnnouncementSchema,
  crewEventSchema,
  crewContributionSchema,
  crewListSchema,
  crewPageSchema,
  type CrewSummary,
  type CrewDetail,
  type CrewMember,
  type CrewJoinRequest,
  type CrewActivity,
  type CrewContribution,
  type CrewEvent,
  type CrewRole,
  type CrewPage,
} from "../domain/crew";
import { uuidSchema } from "../domain/validation";
import { membershipActive } from "../domain/safety";
import { AVATARS } from "../domain/boards";
import { AppError, requireActor } from "./errors";
import { authorVisible, contentVisible } from "./safety-visibility";
import { enforceRequestLimit } from "./request-limits";
import { awardActivity } from "./activity";
import { preciseTimestamp } from "./pagination";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDb = Database | Tx;
type Crew = typeof crews.$inferSelect;
const avatar = (value: string) =>
  AVATARS.includes(value as (typeof AVATARS)[number]) ? value : "spark";
const countMembers = sql<number>`(select count(*)::int from sliper.crew_members m where m.crew_id=sliper.crews.id)`;
const countEvents = (actor: string | null) =>
  sql<number>`(select count(*)::int from sliper.crew_events e join sliper.posts p on p.id=e.post_id where e.crew_id=sliper.crews.id and p.status='published' and not exists(select 1 from sliper.content_restrictions r where r.target_type='post' and r.target_id=p.id and r.hidden) and ${authorVisible(sql`p.author_id`, actor)})`;
const countContributions = (actor: string | null) =>
  sql<number>`(select count(*)::int from sliper.crew_contributions c join sliper.posts p on p.id=c.post_id where c.crew_id=sliper.crews.id and p.status='published' and not exists(select 1 from sliper.content_restrictions r where r.target_type='post' and r.target_id=p.id and r.hidden) and ${authorVisible(sql`p.author_id`, actor)})`;
function pageView<T>(items: T[], total: number, page: number): CrewPage<T> {
  return { items, total, page, nextPage: page * 20 < total ? page + 1 : null };
}
function validId(id: string) {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) throw new AppError("NOT_FOUND", "크루를 찾을 수 없어요.");
  return parsed.data;
}
export function crewService(db: Database, clock = () => new Date()) {
  async function active(connection: QueryDb, user: string) {
    const [profile] = await connection
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, user));
    const [state] = await connection
      .select()
      .from(memberSafety)
      .where(eq(memberSafety.userId, user));
    if (!profile || !membershipActive(state, clock()))
      throw new AppError("FORBIDDEN", "활성 회원만 크루에 참여할 수 있어요.");
  }
  async function throttled(actor: string | null, action: string, limit = 60) {
    const user = requireActor(actor);
    await active(db, user);
    await enforceRequestLimit(db, user, action, limit);
    return user;
  }
  async function lockPeople(tx: Tx, user: string, targets: string[] = [], activeTargets = false) {
    const ids = [...new Set([user, ...targets])].sort();
    const found = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.id, ids))
      .orderBy(asc(profiles.id))
      .for("no key update");
    if (found.length !== ids.length) throw new AppError("NOT_FOUND", "회원을 찾을 수 없어요.");
    await active(tx, user);
    if (activeTargets) for (const target of targets) await active(tx, target);
  }
  async function role(
    connection: QueryDb,
    crew: Crew,
    user: string | null,
  ): Promise<CrewRole | null> {
    if (!user) return null;
    if (crew.ownerId === user) return "owner";
    const [member] = await connection
      .select({ role: crewMembers.role })
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, crew.id), eq(crewMembers.userId, user)));
    return member?.role === "manager" ? "manager" : member ? "member" : null;
  }
  function manage(value: CrewRole | null, ownerOnly = false) {
    if (value !== "owner" && (ownerOnly || value !== "manager"))
      throw new AppError(
        "FORBIDDEN",
        ownerOnly ? "크루 리더만 변경할 수 있어요." : "크루 운영진만 이용할 수 있어요.",
      );
  }
  async function readCrew(
    connection: QueryDb,
    id: string,
    actor: string | null,
    lock: "share" | "update" | false = false,
  ) {
    const query = connection
      .select()
      .from(crews)
      .where(
        and(
          eq(crews.id, validId(id)),
          contentVisible("crew", crews.id),
          authorVisible(crews.ownerId, actor),
        ),
      );
    const [row] = lock ? await query.for(lock) : await query;
    if (!row) throw new AppError("NOT_FOUND", "크루를 찾을 수 없어요.");
    return row;
  }
  async function locked(tx: Tx, id: string, actor: string) {
    const crew = await readCrew(tx, id, actor, "update");
    if (crew.status !== "active") throw new AppError("CONFLICT", "보관한 크루는 변경할 수 없어요.");
    return crew;
  }
  async function publicMember(connection: QueryDb, publicId: string) {
    const [row] = await connection
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.publicId, publicId));
    if (!row) throw new AppError("NOT_FOUND", "멤버를 찾을 수 없어요.");
    return row.id;
  }
  async function touch(tx: Tx, id: string) {
    await tx
      .update(crews)
      .set({ updatedAt: sql`clock_timestamp()` })
      .where(eq(crews.id, id));
  }
  async function log(tx: Tx, id: string, actor: string, kind: string, message: string) {
    await tx.insert(crewActivity).values({ crewId: id, actorId: actor, kind, message });
  }
  async function mutate(
    actor: string | null,
    id: string,
    action: string,
    work: (tx: Tx, crew: Crew, user: string) => Promise<void>,
    target?: { publicId?: string; requestId?: string; active?: boolean; postId?: string },
  ) {
    const user = await throttled(actor, action);
    await db.transaction(async (tx) => {
      // Event flows elsewhere lock posts before awarding profile activity points.
      // Keep this order before profile/crew locks to prevent cross-feature deadlocks.
      if (target?.postId) {
        const [post] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(and(eq(posts.id, target.postId), visibleEvent(user)))
          .for("update");
        if (!post) throw new AppError("NOT_FOUND", "연결할 모집글을 찾을 수 없어요.");
      }
      const targets: string[] = [];
      if (target?.publicId) targets.push(await publicMember(tx, target.publicId));
      if (target?.requestId) {
        const [request] = await tx
          .select({ userId: crewJoinRequests.userId })
          .from(crewJoinRequests)
          .where(
            and(
              eq(crewJoinRequests.id, target.requestId),
              eq(crewJoinRequests.crewId, validId(id)),
            ),
          );
        if (!request) throw new AppError("NOT_FOUND", "가입 신청을 찾을 수 없어요.");
        targets.push(request.userId);
      }
      // Profiles precede crew locks to serialize against account withdrawal.
      await lockPeople(tx, user, targets, target?.active ?? false);
      const crew = await locked(tx, id, user);
      await work(tx, crew, user);
    });
    return detail(user, id);
  }
  async function summaries(
    connection: QueryDb,
    actor: string | null,
    where: SQL,
    limit = 20,
    offset = 0,
  ): Promise<CrewSummary[]> {
    const rows = await connection
      .select({
        crew: crews,
        memberCount: countMembers,
        eventCount: countEvents(actor),
        contributionCount: countContributions(actor),
        revision: preciseTimestamp(crews.updatedAt),
        membership: actor
          ? sql<
              string | null
            >`(select m.role from sliper.crew_members m where m.crew_id=sliper.crews.id and m.user_id=${actor})`
          : sql<string | null>`null`,
      })
      .from(crews)
      .where(and(where, contentVisible("crew", crews.id), authorVisible(crews.ownerId, actor)))
      .orderBy(desc(crews.createdAt), desc(crews.id))
      .limit(limit)
      .offset(offset);
    return rows.map(
      ({ crew, memberCount, eventCount, contributionCount, revision, membership }) => ({
        id: crew.id,
        name: crew.name,
        description: crew.description,
        category: crew.categorySlug,
        region: crew.region,
        capacity: crew.capacity,
        recruiting: crew.recruiting,
        archived: crew.status === "archived",
        memberCount,
        eventCount,
        contributionCount,
        myRole:
          actor === crew.ownerId
            ? "owner"
            : membership === "manager"
              ? "manager"
              : membership
                ? "member"
                : null,
        createdAt: crew.createdAt.toISOString(),
        updatedAt: revision,
      }),
    );
  }
  async function list(actor: string | null, input: unknown = {}): Promise<CrewPage<CrewSummary>> {
    const value = crewListSchema.parse(input),
      conditions: SQL[] = [];
    if (value.mine === "1") {
      const user = requireActor(actor);
      conditions.push(
        sql`(${crews.ownerId}=${user} or exists(select 1 from sliper.crew_members m where m.crew_id=sliper.crews.id and m.user_id=${user}))`,
      );
    } else conditions.push(eq(crews.status, "active"));
    if (value.category) conditions.push(eq(crews.categorySlug, value.category));
    if (value.q) {
      const q = value.q.replace(/[\\%_]/g, "\\$&");
      conditions.push(
        or(
          ilike(crews.name, `%${q}%`),
          ilike(crews.description, `%${q}%`),
          ilike(crews.region, `%${q}%`),
        )!,
      );
    }
    const where = and(...conditions)!;
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(crews)
      .where(and(where, contentVisible("crew", crews.id), authorVisible(crews.ownerId, actor)));
    return pageView(
      await summaries(db, actor, where, 20, (value.page - 1) * 20),
      count?.count ?? 0,
      value.page,
    );
  }
  async function memberList(connection: QueryDb, crew: Crew): Promise<CrewMember[]> {
    const rows = await connection
      .select({
        publicId: profiles.publicId,
        nickname: profiles.nickname,
        avatar: profiles.avatar,
        role: crewMembers.role,
        userId: crewMembers.userId,
        createdAt: crewMembers.createdAt,
      })
      .from(crewMembers)
      .innerJoin(profiles, eq(profiles.id, crewMembers.userId))
      .where(eq(crewMembers.crewId, crew.id))
      .orderBy(asc(crewMembers.createdAt), asc(profiles.publicId))
      .limit(100);
    return rows.map((row) => ({
      publicId: row.publicId,
      nickname: row.nickname,
      avatar: avatar(row.avatar),
      role: row.userId === crew.ownerId ? "owner" : row.role === "manager" ? "manager" : "member",
      joinedAt: row.createdAt.toISOString(),
    }));
  }
  function requestView(
    row: typeof crewJoinRequests.$inferSelect,
    profile: { publicId: string; nickname: string; avatar: string },
  ): CrewJoinRequest {
    return {
      id: row.id,
      publicId: profile.publicId,
      nickname: profile.nickname,
      avatar: avatar(profile.avatar),
      message: row.message,
      status: row.status as CrewJoinRequest["status"],
      createdAt: row.createdAt.toISOString(),
    };
  }
  async function requestPage(
    connection: QueryDb,
    id: string,
    page: number,
  ): Promise<CrewPage<CrewJoinRequest>> {
    const where = and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.status, "pending"));
    const [total] = await connection
      .select({ count: sql<number>`count(*)::int` })
      .from(crewJoinRequests)
      .where(where);
    const rows = await connection
      .select({
        request: crewJoinRequests,
        publicId: profiles.publicId,
        nickname: profiles.nickname,
        avatar: profiles.avatar,
      })
      .from(crewJoinRequests)
      .innerJoin(profiles, eq(profiles.id, crewJoinRequests.userId))
      .where(where)
      .orderBy(asc(crewJoinRequests.createdAt), asc(crewJoinRequests.id))
      .limit(20)
      .offset((page - 1) * 20);
    return pageView(
      rows.map(({ request, ...profile }) => requestView(request, profile)),
      total?.count ?? 0,
      page,
    );
  }
  async function requests(actor: string | null, id: string, input: unknown = {}) {
    const value = crewPageSchema.parse(input);
    return db.transaction(async (tx) => {
      const crew = await readCrew(tx, id, actor, "share");
      manage(await role(tx, crew, actor));
      return requestPage(tx, id, value.page);
    });
  }
  async function activity(
    actor: string | null,
    id: string,
    input: unknown = {},
    connection: QueryDb = db,
  ): Promise<CrewPage<CrewActivity>> {
    const value = crewPageSchema.parse(input);
    await readCrew(connection, id, actor);
    const [total] = await connection
      .select({ count: sql<number>`count(*)::int` })
      .from(crewActivity)
      .where(eq(crewActivity.crewId, id));
    const rows = await connection
      .select({ activity: crewActivity, nickname: profiles.nickname })
      .from(crewActivity)
      .leftJoin(profiles, eq(profiles.id, crewActivity.actorId))
      .where(eq(crewActivity.crewId, id))
      .orderBy(desc(crewActivity.createdAt), desc(crewActivity.id))
      .limit(20)
      .offset((value.page - 1) * 20);
    return pageView(
      rows.map(({ activity: row, nickname }) => ({
        id: row.id,
        kind: row.kind,
        message: row.message,
        nickname: nickname ?? "탈퇴한 회원",
        createdAt: row.createdAt.toISOString(),
      })),
      total?.count ?? 0,
      value.page,
    );
  }
  function visibleEvent(actor: string | null) {
    return and(
      eq(posts.status, "published"),
      eq(posts.kind, "모집"),
      contentVisible("post", posts.id),
      authorVisible(posts.authorId, actor),
    )!;
  }
  function managerEvent(actor: string) {
    return sql<boolean>`(${posts.authorId}=${actor} or exists(select 1 from sliper.room_managers r where r.post_id=${posts.id} and r.user_id=${actor}))`;
  }
  async function events(
    actor: string | null,
    id: string,
    connection: QueryDb = db,
  ): Promise<CrewEvent[]> {
    const rows = await connection
      .select({
        id: posts.id,
        title: posts.title,
        startsAt: eventSettings.startsAt,
        endsAt: eventSettings.endsAt,
        canVerify: actor ? managerEvent(actor) : sql<boolean>`false`,
      })
      .from(crewEvents)
      .innerJoin(posts, eq(posts.id, crewEvents.postId))
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(and(eq(crewEvents.crewId, id), visibleEvent(actor)))
      .orderBy(desc(crewEvents.createdAt))
      .limit(20);
    return rows.map((row) => ({
      postId: row.id,
      title: row.title,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      href: `/posts/${row.id}`,
      canVerify: row.canVerify,
    }));
  }
  async function availableEvents(actor: string | null, id: string) {
    const user = requireActor(actor),
      crew = await readCrew(db, id, user);
    await active(db, user);
    manage(await role(db, crew, user));
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        startsAt: eventSettings.startsAt,
        endsAt: eventSettings.endsAt,
      })
      .from(posts)
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          visibleEvent(user),
          managerEvent(user),
          sql`not exists(select 1 from sliper.crew_events c where c.crew_id=${id} and c.post_id=${posts.id})`,
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(20);
    return {
      items: rows.map((row) => ({
        postId: row.id,
        title: row.title,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        href: `/posts/${row.id}`,
        canVerify: true,
      })),
    };
  }
  async function contributions(
    actor: string | null,
    id: string,
    input: unknown = {},
    connection: QueryDb = db,
  ): Promise<CrewPage<CrewContribution>> {
    const value = crewPageSchema.parse(input);
    await readCrew(connection, id, actor);
    const where = and(eq(crewContributions.crewId, id), visibleEvent(actor));
    const [total] = await connection
      .select({ count: sql<number>`count(*)::int` })
      .from(crewContributions)
      .innerJoin(posts, eq(posts.id, crewContributions.postId))
      .where(where);
    const rows = await connection
      .select({ entry: crewContributions, nickname: profiles.nickname, title: posts.title })
      .from(crewContributions)
      .innerJoin(profiles, eq(profiles.id, crewContributions.userId))
      .innerJoin(posts, eq(posts.id, crewContributions.postId))
      .where(where)
      .orderBy(desc(crewContributions.createdAt), desc(crewContributions.id))
      .limit(20)
      .offset((value.page - 1) * 20);
    return pageView(
      rows.map(({ entry, nickname, title }) => ({
        id: entry.id,
        postId: entry.postId,
        eventTitle: title,
        nickname,
        role: entry.role,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
      total?.count ?? 0,
      value.page,
    );
  }
  async function detail(actor: string | null, id: string): Promise<CrewDetail> {
    return db.transaction(async (tx) => {
      const crew = await readCrew(tx, id, actor, "share"),
        myRole = await role(tx, crew, actor);
      const [summary] = await summaries(tx, actor, eq(crews.id, crew.id), 1);
      if (!summary) throw new AppError("NOT_FOUND", "크루를 찾을 수 없어요.");
      const [members, activityPage, eventRows, contributionPage, queue] = await Promise.all([
        memberList(tx, crew),
        activity(actor, id, {}, tx),
        events(actor, id, tx),
        contributions(actor, id, {}, tx),
        myRole === "owner" || myRole === "manager" ? requestPage(tx, id, 1) : Promise.resolve(null),
      ]);
      let myRequest: CrewJoinRequest | null = null;
      if (actor) {
        const [row] = await tx
          .select({
            request: crewJoinRequests,
            publicId: profiles.publicId,
            nickname: profiles.nickname,
            avatar: profiles.avatar,
          })
          .from(crewJoinRequests)
          .innerJoin(profiles, eq(profiles.id, crewJoinRequests.userId))
          .where(and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.userId, actor)));
        if (row) myRequest = requestView(row.request, row);
      }
      return {
        ...summary,
        members,
        myRequest,
        requests: queue,
        activity: activityPage,
        events: eventRows,
        contributions: contributionPage,
      };
    });
  }
  async function create(actor: string | null, input: unknown): Promise<CrewDetail> {
    const value = crewInputSchema.parse(input),
      user = await throttled(actor, "crew_create", 5);
    const id = await db.transaction(async (tx) => {
      await lockPeople(tx, user);
      const [crew] = await tx
        .insert(crews)
        .values({
          ownerId: user,
          name: value.name,
          description: value.description,
          categorySlug: value.category,
          region: value.region,
          capacity: value.capacity,
          recruiting: value.recruiting,
        })
        .returning({ id: crews.id });
      if (!crew) throw new AppError("CONFLICT", "크루를 만들지 못했어요.");
      await tx.insert(crewMembers).values({ crewId: crew.id, userId: user, role: "manager" });
      await log(tx, crew.id, user, "created", "함께 만드는 크루가 시작됐어요.");
      return crew.id;
    });
    return detail(user, id);
  }
  async function update(actor: string | null, id: string, input: unknown) {
    const value = crewUpdateSchema.parse(input);
    return mutate(actor, id, "crew_update", async (tx, crew, user) => {
      manage(await role(tx, crew, user));
      const [revision] = await tx
        .select({ value: preciseTimestamp(crews.updatedAt) })
        .from(crews)
        .where(eq(crews.id, id));
      if (value.expectedUpdatedAt !== revision?.value)
        throw new AppError("CONFLICT", "다른 운영진이 수정했어요. 새로고침 후 다시 확인해주세요.");
      const [members] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(crewMembers)
        .where(eq(crewMembers.crewId, id));
      if (value.capacity < (members?.count ?? 0))
        throw new AppError("CONFLICT", "현재 멤버 수보다 정원을 줄일 수 없어요.");
      await tx
        .update(crews)
        .set({
          name: value.name,
          description: value.description,
          categorySlug: value.category,
          region: value.region,
          capacity: value.capacity,
          recruiting: value.recruiting,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(crews.id, id));
      await log(tx, id, user, "updated", "크루 소개와 모집 설정을 업데이트했어요.");
    });
  }
  async function join(actor: string | null, id: string, input: unknown) {
    const value = crewJoinSchema.parse(input);
    return mutate(actor, id, "crew_join", async (tx, crew, user) => {
      if (!crew.recruiting) throw new AppError("CONFLICT", "지금은 신규 멤버를 모집하지 않아요.");
      if (await role(tx, crew, user)) throw new AppError("CONFLICT", "이미 크루 멤버예요.");
      const [current] = await tx
        .select()
        .from(crewJoinRequests)
        .where(and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.userId, user)))
        .for("update");
      if (current?.status === "pending") throw new AppError("CONFLICT", "가입 승인 대기 중이에요.");
      await tx
        .insert(crewJoinRequests)
        .values({ crewId: id, userId: user, message: value.message })
        .onConflictDoUpdate({
          target: [crewJoinRequests.crewId, crewJoinRequests.userId],
          set: {
            message: value.message,
            status: "pending",
            decisionBy: null,
            createdAt: clock(),
            updatedAt: clock(),
          },
        });
    });
  }
  async function withdrawRequest(actor: string | null, id: string) {
    return mutate(actor, id, "crew_join", async (tx, _crew, user) => {
      const [row] = await tx
        .update(crewJoinRequests)
        .set({ status: "withdrawn", updatedAt: clock() })
        .where(
          and(
            eq(crewJoinRequests.crewId, id),
            eq(crewJoinRequests.userId, user),
            eq(crewJoinRequests.status, "pending"),
          ),
        )
        .returning({ id: crewJoinRequests.id });
      if (!row) throw new AppError("CONFLICT", "대기 중인 가입 신청이 없어요.");
    });
  }
  async function decide(actor: string | null, id: string, input: unknown) {
    const value = crewDecisionSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_decide",
      async (tx, crew, user) => {
        manage(await role(tx, crew, user));
        const [request] = await tx
          .select()
          .from(crewJoinRequests)
          .where(and(eq(crewJoinRequests.id, value.requestId), eq(crewJoinRequests.crewId, id)))
          .for("update");
        if (!request || request.status !== "pending")
          throw new AppError("CONFLICT", "이미 처리된 가입 신청이에요.");
        if (value.approve) {
          const [current] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(crewMembers)
            .where(eq(crewMembers.crewId, id));
          if ((current?.count ?? 0) >= crew.capacity)
            throw new AppError("CONFLICT", "크루 정원이 가득 찼어요.");
          await tx
            .insert(crewMembers)
            .values({ crewId: id, userId: request.userId, role: "member" });
          await touch(tx, id);
          await log(tx, id, request.userId, "joined", "새 멤버가 크루에 합류했어요.");
        }
        await tx
          .update(crewJoinRequests)
          .set({
            status: value.approve ? "approved" : "rejected",
            decisionBy: user,
            updatedAt: clock(),
          })
          .where(eq(crewJoinRequests.id, request.id));
      },
      { requestId: value.requestId, active: value.approve },
    );
  }
  async function setRole(actor: string | null, id: string, input: unknown) {
    const value = crewRoleSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_manage",
      async (tx, crew, user) => {
        manage(await role(tx, crew, user), true);
        const target = await publicMember(tx, value.memberPublicId);
        if (target === crew.ownerId)
          throw new AppError("CONFLICT", "리더 역할은 리더 양도에서 변경해주세요.");
        const [updated] = await tx
          .update(crewMembers)
          .set({ role: value.role })
          .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, target)))
          .returning();
        if (!updated) throw new AppError("NOT_FOUND", "크루 멤버가 아니에요.");
        await log(
          tx,
          id,
          user,
          "role_changed",
          value.role === "manager" ? "새 운영진을 지정했어요." : "운영진 역할을 변경했어요.",
        );
        await touch(tx, id);
      },
      { publicId: value.memberPublicId, active: true },
    );
  }
  async function removeMember(actor: string | null, id: string, input: unknown) {
    const value = crewTargetSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_manage",
      async (tx, crew, user) => {
        manage(await role(tx, crew, user), true);
        const target = await publicMember(tx, value.memberPublicId);
        if (target === crew.ownerId)
          throw new AppError(
            "CONFLICT",
            "리더는 스스로 제외할 수 없어요. 리더 양도나 크루 보관을 이용해주세요.",
          );
        const [removed] = await tx
          .delete(crewMembers)
          .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, target)))
          .returning();
        if (!removed) throw new AppError("NOT_FOUND", "크루 멤버가 아니에요.");
        await tx
          .update(crewJoinRequests)
          .set({ status: "withdrawn", updatedAt: clock() })
          .where(and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.userId, target)));
        await log(tx, id, user, "removed", "크루 멤버 구성을 정리했어요.");
        await touch(tx, id);
      },
      { publicId: value.memberPublicId },
    );
  }
  async function transfer(actor: string | null, id: string, input: unknown) {
    const value = crewTargetSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_manage",
      async (tx, crew, user) => {
        manage(await role(tx, crew, user), true);
        const target = await publicMember(tx, value.memberPublicId);
        if (target === user || !(await role(tx, crew, target)))
          throw new AppError("CONFLICT", "다른 크루 멤버에게 리더를 양도해주세요.");
        await tx
          .update(crews)
          .set({ ownerId: target, updatedAt: sql`clock_timestamp()` })
          .where(eq(crews.id, id));
        await tx
          .update(crewMembers)
          .set({ role: "manager" })
          .where(and(eq(crewMembers.crewId, id), inArray(crewMembers.userId, [user, target])));
        await log(tx, id, user, "ownership_transferred", "크루 리더를 새 운영진에게 양도했어요.");
      },
      { publicId: value.memberPublicId, active: true },
    );
  }
  async function leave(actor: string | null, id: string) {
    return mutate(actor, id, "crew_manage", async (tx, crew, user) => {
      if (crew.ownerId === user)
        throw new AppError(
          "CONFLICT",
          "리더를 다른 멤버에게 양도하거나 크루를 보관한 뒤 나갈 수 있어요.",
        );
      const [removed] = await tx
        .delete(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, user)))
        .returning();
      if (!removed) throw new AppError("CONFLICT", "크루 멤버가 아니에요.");
      await tx
        .update(crewJoinRequests)
        .set({ status: "withdrawn", updatedAt: clock() })
        .where(and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.userId, user)));
      await log(tx, id, user, "left", "멤버가 크루에서 나갔어요.");
      await touch(tx, id);
    });
  }
  async function archive(actor: string | null, id: string) {
    return mutate(actor, id, "crew_manage", async (tx, crew, user) => {
      manage(await role(tx, crew, user), true);
      await tx
        .update(crews)
        .set({ status: "archived", recruiting: false, updatedAt: sql`clock_timestamp()` })
        .where(eq(crews.id, id));
      await tx
        .update(crewJoinRequests)
        .set({ status: "withdrawn", updatedAt: clock() })
        .where(and(eq(crewJoinRequests.crewId, id), eq(crewJoinRequests.status, "pending")));
      await log(tx, id, user, "archived", "크루를 보관했어요. 활동 기록은 계속 볼 수 있어요.");
    });
  }
  async function announce(actor: string | null, id: string, input: unknown) {
    const value = crewAnnouncementSchema.parse(input);
    return mutate(actor, id, "crew_announce", async (tx, crew, user) => {
      manage(await role(tx, crew, user));
      await log(tx, id, user, "announcement", value.body);
    });
  }
  async function managedEvent(tx: Tx, user: string, postId: string) {
    const [post] = await tx
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), visibleEvent(user)))
      .for("update");
    if (!post) throw new AppError("NOT_FOUND", "연결할 모집글을 찾을 수 없어요.");
    const [manager] = await tx
      .select({ userId: roomManagers.userId })
      .from(roomManagers)
      .where(and(eq(roomManagers.postId, postId), eq(roomManagers.userId, user)));
    if (post.authorId !== user && !manager)
      throw new AppError(
        "FORBIDDEN",
        "본인이 주최하거나 담당하는 행사만 연결하고 확인할 수 있어요.",
      );
    const [settings] = await tx
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId));
    if (!settings) throw new AppError("CONFLICT", "행사 설정이 필요해요.");
    return { post, settings };
  }
  async function linkEvent(actor: string | null, id: string, input: unknown) {
    const value = crewEventSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_event",
      async (tx, crew, user) => {
        manage(await role(tx, crew, user));
        await managedEvent(tx, user, value.postId);
        const [linked] = await tx
          .insert(crewEvents)
          .values({ crewId: id, postId: value.postId, linkedBy: user })
          .onConflictDoNothing()
          .returning();
        if (!linked) throw new AppError("CONFLICT", "이미 연결된 행사예요.");
        await log(tx, id, user, "event_linked", "크루의 새 행사를 연결했어요.");
        await touch(tx, id);
      },
      { postId: value.postId },
    );
  }
  async function unlinkEvent(actor: string | null, id: string, postId: string) {
    const value = crewEventSchema.parse({ postId });
    return mutate(actor, id, "crew_event", async (tx, crew, user) => {
      manage(await role(tx, crew, user));
      const [contribution] = await tx
        .select({ id: crewContributions.id })
        .from(crewContributions)
        .where(and(eq(crewContributions.crewId, id), eq(crewContributions.postId, value.postId)))
        .limit(1);
      if (contribution)
        throw new AppError("CONFLICT", "기여 인증 기록이 있는 행사는 연결을 해제할 수 없어요.");
      const [removed] = await tx
        .delete(crewEvents)
        .where(and(eq(crewEvents.crewId, id), eq(crewEvents.postId, value.postId)))
        .returning();
      if (!removed) throw new AppError("NOT_FOUND", "연결된 행사를 찾을 수 없어요.");
      await log(tx, id, user, "event_unlinked", "행사 연결을 정리했어요.");
      await touch(tx, id);
    });
  }
  async function verifyContribution(actor: string | null, id: string, input: unknown) {
    const value = crewContributionSchema.parse(input);
    return mutate(
      actor,
      id,
      "crew_verify",
      async (tx, crew, user) => {
        const target = await publicMember(tx, value.memberPublicId);
        if (!(await role(tx, crew, user)))
          throw new AppError("FORBIDDEN", "크루 멤버인 행사 담당자만 기여를 확인할 수 있어요.");
        if (!(await role(tx, crew, target)))
          throw new AppError("CONFLICT", "크루 멤버만 행사 기여를 인증할 수 있어요.");
        if (user === target)
          throw new AppError("FORBIDDEN", "본인의 기여는 다른 행사 담당자가 확인해야 해요.");
        const [linked] = await tx
          .select()
          .from(crewEvents)
          .where(and(eq(crewEvents.crewId, id), eq(crewEvents.postId, value.postId)));
        if (!linked) throw new AppError("CONFLICT", "먼저 이 크루에 행사를 연결해주세요.");
        const { post, settings } = await managedEvent(tx, user, value.postId);
        const [lifecycle] = await tx
          .select()
          .from(eventLifecycle)
          .where(eq(eventLifecycle.postId, value.postId));
        if (post.sample || !settings.endsAt || settings.endsAt > clock() || lifecycle?.cancelledAt)
          throw new AppError(
            "CONFLICT",
            "취소되지 않고 실제 종료된 행사에서만 기여를 인증할 수 있어요.",
          );
        const [result] = await tx
          .select({ applicationId: eventResults.applicationId })
          .from(eventResults)
          .innerJoin(
            eventAdmissions,
            and(
              eq(eventAdmissions.applicationId, eventResults.applicationId),
              eq(eventAdmissions.postId, eventResults.postId),
              eq(eventAdmissions.userId, eventResults.userId),
            ),
          )
          .where(
            and(
              eq(eventResults.postId, value.postId),
              eq(eventResults.userId, target),
              eq(eventResults.presence, "attended"),
            ),
          );
        if (!result)
          throw new AppError(
            "CONFLICT",
            "QR 입장과 참가 완료 기록이 확인된 멤버만 기여를 인증할 수 있어요.",
          );
        const [inserted] = await tx
          .insert(crewContributions)
          .values({
            crewId: id,
            postId: value.postId,
            userId: target,
            applicationId: result.applicationId,
            role: value.role,
            note: value.note,
            checkedBy: user,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted) throw new AppError("CONFLICT", "이 멤버의 행사 기여는 이미 인증됐어요.");
        await awardActivity(tx, target, "crew", value.postId);
        await log(tx, id, user, "contribution", "QR 참가 기록을 바탕으로 행사 기여를 확인했어요.");
        await touch(tx, id);
      },
      { publicId: value.memberPublicId, active: true, postId: value.postId },
    );
  }
  return {
    list,
    detail,
    activity,
    requests,
    contributions,
    availableEvents,
    create,
    update,
    join,
    withdrawRequest,
    decide,
    setRole,
    removeMember,
    transfer,
    leave,
    archive,
    announce,
    linkEvent,
    unlinkEvent,
    verifyContribution,
  };
}
