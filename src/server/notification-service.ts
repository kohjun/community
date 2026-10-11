import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { notifications, posts } from "../db/schema";
import { uuidSchema } from "../domain/validation";
import type { InboxPage, PageQuery, ReadReceipt } from "../domain/community";
import { presentNotification } from "../domain/presenters";
import { requireActor } from "./errors";
import {
  afterPosition,
  decodeCursor,
  encodeCursor,
  pageQuerySchema,
  pageScope,
  preciseTimestamp,
} from "./pagination";
export function notificationService(db: Database) {
  async function unreadCount(actor: string) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .innerJoin(posts, eq(posts.id, notifications.postId))
      .where(
        and(
          eq(notifications.recipientId, actor),
          eq(posts.status, "published"),
          isNull(notifications.readAt),
        ),
      );
    return row?.count ?? 0;
  }
  async function inbox(actor: string | null, input: PageQuery = {}): Promise<InboxPage> {
    const q = pageQuerySchema.parse(input);
    if (!actor) return { items: [], nextCursor: null, unreadCount: 0 };
    const scope = pageScope(["inbox", actor]),
      cursor = decodeCursor(q.cursor, scope);
    const [rows, unread] = await Promise.all([
      db
        .select({
          notification: notifications,
          timestamp: preciseTimestamp(notifications.createdAt),
        })
        .from(notifications)
        .innerJoin(posts, eq(posts.id, notifications.postId))
        .where(
          and(
            eq(notifications.recipientId, actor),
            eq(posts.status, "published"),
            cursor
              ? afterPosition(notifications.createdAt, notifications.id, cursor, "desc")
              : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.limit + 1),
      unreadCount(actor),
    ]);
    const items = rows
        .slice(0, q.limit)
        .map((r) => ({ ...presentNotification(r.notification, actor), createdAt: r.timestamp })),
      tail = items.at(-1);
    return {
      items,
      nextCursor: rows.length > q.limit && tail ? encodeCursor(scope, tail) : null,
      unreadCount: unread,
    };
  }
  async function markRead(actor: string | null, id?: string): Promise<ReadReceipt> {
    const userId = requireActor(actor);
    const readAt = new Date();
    await db
      .update(notifications)
      .set({ readAt })
      .where(
        and(
          eq(notifications.recipientId, userId),
          isNull(notifications.readAt),
          sql`${notifications.createdAt} <= ${readAt.toISOString()}::timestamptz`,
          id ? eq(notifications.id, uuidSchema.parse(id)) : undefined,
        ),
      );
    return {
      id: id ?? null,
      readAt: readAt.toISOString().replace("Z", "000Z"),
      unreadCount: await unreadCount(userId),
    };
  }
  return { inbox, markRead };
}
