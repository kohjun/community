import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { eventIdeas, ideaInterests, ideaEvents, eventReflections } from "../db/growth-schema";
import { posts, profiles, eventSettings, mediaAssets, eventRecords } from "../db/schema";
import {
  ideaSchema,
  reflectionSchema,
  type IdeaView,
  type ReunionView,
} from "../domain/community-growth";
import { safetyService } from "./safety-service";
import { contentVisible } from "./safety-visibility";
import { growthMemberVisible } from "./growth-policy";
import { assertContentAllowed } from "./content-policy";
import { enforceRequestLimit } from "./request-limits";
import { AppError } from "./errors";
import { participationAttended } from "./verified-review-policy";
import { recordVisible } from "./record-policy";
import { resultRows } from "./saved-search-service";
export function communityGrowthService(db: Database) {
  const active = safetyService(db).activeMember;
  const visible = (u: string) =>
    and(
      eq(posts.status, "published"),
      contentVisible("post", posts.id),
      growthMemberVisible(posts.authorId, sql`${u}::uuid`),
    );
  async function ideas(
    actor: string | null,
    page = 1,
    region = "",
  ): Promise<{ items: IdeaView[]; hasMore: boolean }> {
    const u = await active(actor);
    z.number().int().min(1).max(1000).parse(page);
    z.string().max(60).parse(region);
    const rows = await db
      .select({
        p: posts,
        i: eventIdeas,
        count: sql<number>`(select count(*)::int from sliper.idea_interests ii where ii.post_id=${posts.id} and ${growthMemberVisible(sql`ii.user_id`, sql`${u}::uuid`)})`,
        interested: sql<boolean>`exists(select 1 from sliper.idea_interests ii where ii.post_id=${posts.id} and ii.user_id=${u})`,
      })
      .from(eventIdeas)
      .innerJoin(posts, eq(posts.id, eventIdeas.postId))
      .where(
        and(
          visible(u),
          eq(posts.kind, "이야기"),
          eq(posts.spoiler, false),
          region ? sql`position(lower(${region}) in lower(${eventIdeas.region}))>0` : undefined,
        ),
      )
      .orderBy(desc(eventIdeas.createdAt), desc(posts.id))
      .limit(21)
      .offset((page - 1) * 20);
    const ids = rows.slice(0, 20).map((r) => r.p.id);
    const links = ids.length
      ? await db
          .select({ ideaId: ideaEvents.ideaId, id: posts.id, title: posts.title })
          .from(ideaEvents)
          .innerJoin(posts, eq(posts.id, ideaEvents.eventId))
          .where(and(inArray(ideaEvents.ideaId, ids), visible(u)))
      : [];
    const items: IdeaView[] = [];
    for (const { p, i, count, interested } of rows.slice(0, 20)) {
      const events = links.filter((l) => l.ideaId === p.id).map(({ id, title }) => ({ id, title }));
      items.push({
        id: p.id,
        title: p.title,
        body: p.bodyMarkdown,
        category: p.categorySlug,
        region: i.region,
        dateFrom: i.dateFrom,
        dateTo: i.dateTo,
        closed:
          i.closed ||
          i.dateTo <
            new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()),
        mine: p.authorId === u,
        count,
        interested,
        events,
      });
    }
    return { items, hasMore: rows.length > 20 };
  }
  async function createIdea(actor: string | null, input: unknown) {
    const u = await active(actor),
      v = ideaSchema.parse(input);
    assertContentAllowed({ title: v.title, body: v.body, region: v.region });
    await enforceRequestLimit(db, u, "idea", 10);
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
    if (v.dateTo < today)
      throw new AppError("VALIDATION", "가능한 날짜는 오늘 이후로 설정해주세요.");
    if (v.sourceEventId) {
      const reunion = await reunionView(u, v.sourceEventId);
      if (!reunion.canWrite)
        throw new AppError("FORBIDDEN", "참가한 완료 행사에서 다음 활동을 제안할 수 있어요.");
    }
    const id = await db.transaction(async (tx) => {
      const [post] = await tx
        .insert(posts)
        .values({
          authorId: u,
          categorySlug: v.category,
          kind: "이야기",
          discussionType: "question",
          title: v.title,
          bodyMarkdown: v.body,
          isAnonymous: false,
          tags: ["모임제안"],
          topic: null,
        })
        .returning({ id: posts.id });
      await tx.insert(eventIdeas).values({
        postId: post!.id,
        region: v.region,
        dateFrom: v.dateFrom,
        dateTo: v.dateTo,
        sourceEventId: v.sourceEventId,
      });
      return post!.id;
    });
    return { id };
  }
  async function interest(actor: string | null, id: string, input: unknown) {
    const u = await active(actor),
      v = z.strictObject({ interested: z.boolean() }).parse(input);
    z.uuid().parse(id);
    await enforceRequestLimit(db, u, "idea-interest", 60);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ i: eventIdeas })
        .from(eventIdeas)
        .innerJoin(posts, eq(posts.id, eventIdeas.postId))
        .where(and(eq(posts.id, id), visible(u)))
        .for("update");
      if (!row) throw new AppError("NOT_FOUND", "제안을 찾을 수 없어요.");
      if (v.interested) {
        if (
          row.i.closed ||
          row.i.dateTo <
            new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date())
        )
          throw new AppError("CONFLICT", "관심 접수가 끝났어요.");
        await tx.insert(ideaInterests).values({ postId: id, userId: u }).onConflictDoNothing();
      } else
        await tx
          .delete(ideaInterests)
          .where(and(eq(ideaInterests.postId, id), eq(ideaInterests.userId, u)));
    });
    return { ok: true };
  }
  async function closeIdea(actor: string | null, id: string, input: unknown) {
    const u = await active(actor),
      v = z.strictObject({ closed: z.boolean() }).parse(input);
    z.uuid().parse(id);
    const [p] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, id), eq(posts.authorId, u), visible(u)));
    if (!p) throw new AppError("FORBIDDEN", "본인의 제안만 마감할 수 있어요.");
    await db.update(eventIdeas).set({ closed: v.closed }).where(eq(eventIdeas.postId, id));
    return { ok: true };
  }
  async function linkEvent(actor: string | null, id: string, input: unknown) {
    const u = await active(actor),
      v = z.strictObject({ eventId: z.uuid(), linked: z.boolean() }).parse(input);
    z.uuid().parse(id);
    await enforceRequestLimit(db, u, "idea-link", 30);
    await db.transaction(async (tx) => {
      const [idea] = await tx
        .select({ id: posts.id })
        .from(eventIdeas)
        .innerJoin(posts, eq(posts.id, eventIdeas.postId))
        .where(and(eq(posts.id, id), visible(u)))
        .for("update");
      if (!idea) throw new AppError("NOT_FOUND", "제안을 찾을 수 없어요.");
      const [event] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(eq(posts.id, v.eventId), eq(posts.kind, "모집"), eq(posts.authorId, u), visible(u)),
        )
        .for("update");
      if (!event) throw new AppError("FORBIDDEN", "직접 주최하는 공개 모집만 연결할 수 있어요.");
      if (v.linked) {
        const n = await tx
          .select({ id: ideaEvents.eventId })
          .from(ideaEvents)
          .where(eq(ideaEvents.ideaId, id));
        if (n.length >= 10)
          throw new AppError("CONFLICT", "제안당 최대 10개 모집을 연결할 수 있어요.");
        await tx
          .insert(ideaEvents)
          .values({ ideaId: id, eventId: v.eventId })
          .onConflictDoNothing();
      } else
        await tx
          .delete(ideaEvents)
          .where(and(eq(ideaEvents.ideaId, id), eq(ideaEvents.eventId, v.eventId)));
    });
    return { ok: true };
  }
  async function reunionView(actor: string | null, id: string, page = 1): Promise<ReunionView> {
    const u = await active(actor);
    z.uuid().parse(id);
    z.number().int().min(1).max(1000).parse(page);
    const [event] = await db
      .select({ title: posts.title, author: posts.authorId, completed: eventSettings.completedAt })
      .from(posts)
      .innerJoin(eventSettings, eq(eventSettings.postId, posts.id))
      .where(
        and(
          eq(posts.id, id),
          visible(u),
          eq(posts.sample, false),
          sql`${eventSettings.completedAt} is not null and not exists(select 1 from sliper.event_lifecycle l where l.post_id=${id} and l.cancelled_at is not null)`,
        ),
      );
    if (!event) throw new AppError("NOT_FOUND", "완료된 모임을 찾을 수 없어요.");
    const [access] = resultRows<{ participant: boolean; manager: boolean }>(
      await db.execute(
        sql`select exists(select 1 from sliper.event_applications a where a.post_id=${id} and a.user_id=${u} and ${participationAttended({ applicationId: sql`a.id`, postId: sql`a.post_id`, userId: sql`a.user_id` })}) participant,exists(select 1 from sliper.room_managers m where m.post_id=${id} and m.user_id=${u}) manager`,
      ),
    );
    const canWrite = event.author === u || !!access?.participant,
      canReadPrivate = canWrite || !!access?.manager;
    const notes = await db
      .select({
        id: eventReflections.id,
        body: eventReflections.body,
        nextWish: eventReflections.nextWish,
        visibility: eventReflections.visibility,
        version: eventReflections.version,
        mine: sql<boolean>`${eventReflections.userId}=${u}::uuid`,
        photos: eventReflections.photos,
        nickname: profiles.nickname,
      })
      .from(eventReflections)
      .innerJoin(profiles, eq(profiles.id, eventReflections.userId))
      .where(
        and(
          eq(eventReflections.postId, id),
          growthMemberVisible(eventReflections.userId, sql`${u}::uuid`),
          canReadPrivate ? undefined : eq(eventReflections.visibility, "members"),
        ),
      )
      .orderBy(desc(eventReflections.createdAt), desc(eventReflections.id))
      .limit(21)
      .offset((page - 1) * 20);
    const [rec] = await db
      .select({ id: eventRecords.postId })
      .from(eventRecords)
      .where(and(eq(eventRecords.postId, id), recordVisible(u)));
    const relatedIdeas = await db
      .select({ id: posts.id, title: posts.title })
      .from(eventIdeas)
      .innerJoin(posts, eq(posts.id, eventIdeas.postId))
      .where(and(eq(eventIdeas.sourceEventId, id), visible(u)))
      .limit(20);
    const [own] = await db
      .select({
        body: eventReflections.body,
        nextWish: eventReflections.nextWish,
        visibility: eventReflections.visibility,
        version: eventReflections.version,
        photos: eventReflections.photos,
      })
      .from(eventReflections)
      .where(and(eq(eventReflections.postId, id), eq(eventReflections.userId, u)));
    return {
      postId: id,
      title: event.title,
      canWrite,
      canReadPrivate,
      own: own ?? null,
      hasMore: notes.length > 20,
      recordUrl: rec ? "/records/" + id : null,
      notes: notes.slice(0, 20),
      relatedIdeas,
    };
  }
  async function saveReflection(actor: string | null, id: string, input: unknown) {
    const u = await active(actor),
      v = reflectionSchema.parse(input);
    const event = await reunionView(u, id);
    if (!event.canWrite)
      throw new AppError("FORBIDDEN", "실제 참가 확인 후 경험을 남길 수 있어요.");
    assertContentAllowed({ body: v.body, note: v.nextWish });
    await enforceRequestLimit(db, u, "reflection", 30);
    await db.transaction(async (tx) => {
      await tx.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).for("update");
      const current = await communityGrowthService(tx as unknown as Database).reunionView(u, id);
      if (!current.canWrite) throw new AppError("FORBIDDEN", "참가 확인 상태가 변경되었어요.");
      const [old] = await tx
        .select()
        .from(eventReflections)
        .where(and(eq(eventReflections.postId, id), eq(eventReflections.userId, u)));
      if ((old?.version ?? 0) !== v.version)
        throw new AppError("CONFLICT", "다른 화면에서 수정했어요. 새로고침 후 확인해주세요.");
      const images = v.photos.length
        ? await tx
            .select()
            .from(mediaAssets)
            .where(inArray(mediaAssets.id, v.photos))
            .orderBy(asc(mediaAssets.id))
            .for("update")
        : [];
      if (
        images.length !== v.photos.length ||
        images.some(
          (a) =>
            a.uploaderId !== u ||
            a.status !== "ready" ||
            a.postId ||
            a.recordPostId ||
            a.recordOriginPostId ||
            (a.reunionOriginPostId && a.reunionOriginPostId !== id),
        )
      )
        throw new AppError("FORBIDDEN", "본인이 올린 이 모임의 사진만 첨부할 수 있어요.");
      for (const a of images)
        await tx
          .update(mediaAssets)
          .set({ reunionOriginPostId: id, unattachedSince: null })
          .where(eq(mediaAssets.id, a.id));
      const data = {
        photos: v.photos,
        body: v.body,
        nextWish: v.nextWish,
        visibility: v.visibility,
        version: v.version + 1,
      };
      if (old) await tx.update(eventReflections).set(data).where(eq(eventReflections.id, old.id));
      else await tx.insert(eventReflections).values({ postId: id, userId: u, ...data });
    });
    return reunionView(u, id);
  }
  async function deleteReflection(actor: string | null, id: string) {
    const u = await active(actor);
    z.uuid().parse(id);
    await db
      .delete(eventReflections)
      .where(and(eq(eventReflections.postId, id), eq(eventReflections.userId, u)));
    return { ok: true };
  }
  return {
    ideas,
    createIdea,
    interest,
    closeIdea,
    linkEvent,
    reunionView,
    saveReflection,
    deleteReflection,
  };
}
