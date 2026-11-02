import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { savedSearches } from "../db/growth-schema";
import { profiles } from "../db/schema";
import { savedSearchSchema, type SavedSearchView } from "../domain/community-growth";
import { safetyService } from "./safety-service";
import { savedSearchEligible, growthMemberVisible } from "./growth-policy";
import { AppError } from "./errors";
import { enforceRequestLimit } from "./request-limits";
import { insertInbox } from "./engagement-events";
import { enqueueInboxPush } from "./engagement-push-events";
export function resultRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];
}
export function savedSearchService(db: Database) {
  const active = safetyService(db).activeMember;
  async function list(actor: string | null): Promise<SavedSearchView[]> {
    const u = await active(actor);
    return (
      await db
        .select()
        .from(savedSearches)
        .where(eq(savedSearches.userId, u))
        .orderBy(asc(savedSearches.createdAt))
    ).map((r) => ({ id: r.id, ...r.settings, createdAt: r.createdAt.toISOString() }));
  }
  async function save(actor: string | null, input: unknown, id?: string) {
    const u = await active(actor),
      v = savedSearchSchema.parse(input);
    if (id) z.uuid().parse(id);
    await enforceRequestLimit(db, u, "saved-search", 30);
    await db.transaction(async (tx) => {
      await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, u)).for("update");
      if (id) {
        const [old] = await tx
          .select()
          .from(savedSearches)
          .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, u)));
        if (!old) throw new AppError("NOT_FOUND", "저장 조건을 찾을 수 없어요.");
        await tx
          .update(savedSearches)
          .set({ settings: v, nextScanAt: new Date() })
          .where(eq(savedSearches.id, id));
      } else {
        const rows = await tx
          .select({ id: savedSearches.id })
          .from(savedSearches)
          .where(eq(savedSearches.userId, u));
        if (rows.length >= 10)
          throw new AppError("VALIDATION", "검색 조건은 최대 10개까지 저장할 수 있어요.");
        await tx.insert(savedSearches).values({ userId: u, settings: v });
      }
    });
    return list(u);
  }
  async function remove(actor: string | null, id: string) {
    const u = await active(actor);
    z.uuid().parse(id);
    await db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, u)));
    return list(u);
  }
  async function matches(actor: string | null, id: string, page = 1) {
    const user = await active(actor);
    z.uuid().parse(id);
    z.number().int().min(1).max(1000).parse(page);
    const [owned] = await db
      .select({ id: savedSearches.id })
      .from(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, user)));
    if (!owned) throw new AppError("NOT_FOUND", "저장 조건을 찾을 수 없어요.");
    const rows = resultRows<{
      id: string;
      title: string;
      location: string;
      starts_at: string;
      amount: number;
    }>(
      await db.execute(
        sql`select p.id,p.title,p.location,e.starts_at::text,e.amount_krw amount from sliper.posts p join sliper.event_settings e on e.post_id=p.id where ${savedSearchEligible(sql`${user}::uuid`, sql`p.id`, sql`${id}::uuid`, true)} order by e.starts_at,p.id limit 21 offset ${(page - 1) * 20}`,
      ),
    );
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
  }
  async function scan() {
    return db.transaction(async (tx) => {
      const searches = await tx
        .select()
        .from(savedSearches)
        .where(sql`next_scan_at<=statement_timestamp()`)
        .orderBy(asc(savedSearches.nextScanAt), asc(savedSearches.id))
        .limit(20)
        .for("update", { skipLocked: true });
      let created = 0;
      for (const s of searches) {
        await tx
          .update(savedSearches)
          .set({ nextScanAt: new Date(Date.now() + 60000) })
          .where(eq(savedSearches.id, s.id));
        if (
          s.settings.frequency === "off" ||
          (s.settings.frequency === "daily" &&
            s.lastDeliveredAt &&
            Date.now() - s.lastDeliveredAt.getTime() < 86400000)
        )
          continue;
        const candidates = resultRows<{ id: string }>(
          await tx.execute(
            sql`select p.id from sliper.posts p where p.created_at>=${s.createdAt.toISOString()}::timestamptz and ${savedSearchEligible(sql`${s.userId}::uuid`, sql`p.id`, sql`${s.id}::uuid`)} and ${growthMemberVisible(sql`${s.userId}::uuid`, sql`p.author_id`)} and not exists(select 1 from sliper.inbox_items i where i.recipient_id=${s.userId} and i.dedupe_key='saved:'||p.id::text) order by p.created_at,p.id limit ${s.settings.frequency === "daily" ? 1 : 20}`,
          ),
        );
        for (const p of candidates) {
          const item = {
            recipientId: s.userId,
            postId: p.id,
            sourceId: s.id,
            dedupeKey: "saved:" + p.id,
            kind: "subscriptions" as const,
            title: "저장한 조건에 맞는 모임이 있어요",
            body:
              s.settings.frequency === "daily"
                ? "하루 한 번 받는 모집 알림이에요. 저장 조건에서 다른 모임도 찾아보세요."
                : "저장한 검색 조건에 맞는 새 모집을 확인해주세요.",
            url: s.settings.frequency === "daily" ? "/discover/saved" : "/events/" + p.id,
          };
          if ((await insertInbox(tx, item)).length) {
            created++;
            await enqueueInboxPush(tx, item);
            await tx
              .update(savedSearches)
              .set({ lastDeliveredAt: new Date() })
              .where(eq(savedSearches.id, s.id));
          }
        }
      }
      return created;
    });
  }
  return { list, save, remove, matches, scan };
}
