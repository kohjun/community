import { previewTitleSql } from "./discussion-policy";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/connection";
import { engagementJobs, inboxItems } from "../db/engagement-schema";
import { posts } from "../db/schema";
import type { InboxKind } from "../domain/engagement";
import { insertInbox } from "./engagement-events";
import { engagementInboxEligibility } from "./engagement-eligibility";
import { enqueueInboxPush } from "./engagement-push-events";
type Job = typeof engagementJobs.$inferSelect;
function rawRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows))
    return result.rows as T[];
  return [];
}
type Recipient = { recipient_id: string; created_at: Date | string; read_at: Date | string | null };
const kinds = {
  comment: "comments",
  announcement: "announcements",
  participation: "participation",
  "event-change": "participation",
  subscription: "subscriptions",
} as const;
const titles: Record<InboxKind, string> = {
  credits: "제작진 경력 확인 요청이 도착했어요",
  records: "행사 기록이 발행되었어요",
  comments: "새 댓글·답글이 도착했어요",
  announcements: "공지방에 새 공지가 올라왔어요",
  participation: "참가 현황이 바뀌었어요",
  subscriptions: "구독한 새 모집글이 올라왔어요",
  reminders: "참가할 행사 일정을 확인해주세요",
};
export function reminderStage(startsAt: Date, joinedAt: Date, now: Date): "24h" | "2h" | null {
  const remaining = startsAt.getTime() - now.getTime();
  if (remaining <= 0 || remaining > 24 * 3600000) return null;
  const stage = remaining > 2 * 3600000 ? "24h" : "2h";
  const due = startsAt.getTime() - (stage === "24h" ? 24 : 2) * 3600000;
  return joinedAt.getTime() <= due ? stage : null;
}
export function reminderDedupe(
  applicationId: string,
  startsAt: Date,
  revision: number,
  stage: "24h" | "2h",
) {
  return ["reminder", applicationId, startsAt.getTime(), revision, stage].join(":");
}
function jobDedupe(job: Job) {
  if (job.kind === "comment") return "comment:" + job.sourceId;
  if (job.kind === "announcement") return "room:" + job.sourceId;
  if (job.kind === "event-change") return "event-change:" + job.sourceId;
  if (job.kind === "participation") return "application:" + job.sourceId + ":" + job.payload.status;
  return "subscription:" + job.postId;
}
function recipientSource(job: Job): SQL {
  if (job.kind === "comment")
    return sql`select n.recipient_id,n.created_at,n.read_at from sliper.notifications n
    where n.post_id=${job.postId}::uuid and n.comment_id=${job.sourceId}::uuid and n.recipient_id=${job.payload.recipientId ?? null}::uuid`;
  if (job.kind === "event-change")
    return sql`select r.user_id recipient_id,min(r.created_at) created_at,
    case when bool_or(r.read_at is null) then null else min(r.read_at) end read_at from sliper.event_change_recipients r
    where r.post_id=${job.postId}::uuid and r.change_id=${job.sourceId}::uuid and r.user_id=${job.payload.recipientId ?? null}::uuid group by r.user_id`;
  if (job.kind === "participation")
    return sql`select a.user_id recipient_id,${job.createdAt.toISOString()}::timestamptz created_at,null::timestamptz read_at
    from sliper.event_applications a where a.id=${job.sourceId}::uuid and a.post_id=${job.postId}::uuid`;
  if (job.kind === "announcement")
    return sql`select audience.user_id recipient_id,${job.createdAt.toISOString()}::timestamptz created_at,null::timestamptz read_at
    from (select p.author_id user_id from sliper.posts p where p.id=${job.postId}::uuid and p.author_id is not null
      union select mgr.user_id from sliper.room_managers mgr where mgr.post_id=${job.postId}::uuid and mgr.created_at<=${job.createdAt.toISOString()}::timestamptz
      union select m.user_id from sliper.room_members m join sliper.event_applications a on a.id=m.application_id
        where m.post_id=${job.postId}::uuid and m.revoked_at is null and a.status='confirmed' and m.created_at<=${job.createdAt.toISOString()}::timestamptz) audience`;
  return sql`select audience.user_id recipient_id,${job.createdAt.toISOString()}::timestamptz created_at,null::timestamptz read_at
    from (select subscription.user_id from sliper.category_subscriptions subscription join sliper.posts p on p.category_slug::text=subscription.category_slug
      where p.id=${job.postId}::uuid and subscription.created_at<=p.created_at
      union select subscription.user_id from sliper.host_subscriptions subscription join sliper.posts p on p.author_id=subscription.host_id
        where p.id=${job.postId}::uuid and not p.is_anonymous and subscription.created_at<=p.created_at) audience`;
}
export function engagementWorker(db: Database, clock: () => Date = () => new Date()) {
  async function processJobs(limit = 100) {
    const count = Math.min(500, Math.max(1, Math.floor(limit)));
    const now = clock();
    return db.transaction(async (tx) => {
      const jobs = await tx
        .select()
        .from(engagementJobs)
        .where(
          and(
            isNull(engagementJobs.completedAt),
            sql`${engagementJobs.availableAt}<=${now.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(
          asc(engagementJobs.availableAt),
          asc(engagementJobs.createdAt),
          asc(engagementJobs.id),
        )
        .limit(10)
        .for("update", { skipLocked: true });
      let jobsProcessed = 0,
        inboxCreated = 0,
        remaining = count;
      for (const job of jobs) {
        if (remaining <= 0) break;
        try {
          const outcome = await tx.transaction(async (child) => {
            let created = 0;
            const [post] = await child
              .select({ title: previewTitleSql })
              .from(posts)
              .where(eq(posts.id, job.postId));
            const kind = kinds[job.kind],
              dedupeKey = jobDedupe(job);
            if (
              job.kind === "participation" &&
              ![
                "confirmed",
                "refunded",
                "cancelled",
                "rejected",
                "pending_approval",
                "review",
              ].includes(job.payload.status ?? "")
            ) {
              await child
                .update(engagementJobs)
                .set({ completedAt: now, lastError: "INVALID_SOURCE_STATUS" })
                .where(eq(engagementJobs.id, job.id));
              return { consumed: 0, created: 0 };
            }
            const candidates =
              await child.execute(sql`select candidate.* from (${recipientSource(job)}) candidate
          where (${job.recipientCursor}::uuid is null or candidate.recipient_id>${job.recipientCursor}::uuid)
            and ${engagementInboxEligibility({ recipientId: sql`candidate.recipient_id`, kind: sql`${kind}`, postId: sql`${job.postId}::uuid`, sourceId: sql`${job.sourceId}::uuid`, dedupeKey: sql`${dedupeKey}`, createdAt: sql`candidate.created_at` }, { now: sql`${now.toISOString()}::timestamptz` })}
          order by candidate.recipient_id limit ${remaining}`);
            const recipients = rawRows<Recipient>(candidates);
            for (const recipient of recipients) {
              const item: typeof inboxItems.$inferInsert = {
                recipientId: recipient.recipient_id,
                kind,
                postId: job.postId,
                sourceId: job.sourceId,
                dedupeKey,
                title: job.kind === "event-change" ? "참가 행사 변경 안내" : titles[kind],
                body: post?.title ?? "Sliper에서 내용을 확인해주세요.",
                url:
                  kind === "announcements"
                    ? "/rooms/" + job.postId
                    : kind === "participation"
                      ? "/participation"
                      : kind === "subscriptions"
                        ? "/events/" + job.postId
                        : "/?post=" + job.postId,
                createdAt: new Date(recipient.created_at),
                readAt: recipient.read_at ? new Date(recipient.read_at) : null,
              };
              if ((await insertInbox(child, item)).length) {
                created++;
                await enqueueInboxPush(child, item);
              }
            }
            const exhausted = recipients.length < remaining;
            await child
              .update(engagementJobs)
              .set({
                recipientCursor: recipients.at(-1)?.recipient_id ?? job.recipientCursor,
                completedAt: exhausted ? now : null,
                availableAt: exhausted ? job.availableAt : new Date(now.getTime() + 2000),
                attempts: 0,
                leaseUntil: null,
                lastError: null,
              })
              .where(eq(engagementJobs.id, job.id));
            return { consumed: recipients.length, created };
          });
          remaining -= outcome.consumed;
          inboxCreated += outcome.created;
        } catch {
          // One malformed source must not roll back other jobs or log private SQL.
          const attempts = job.attempts + 1;
          await tx
            .update(engagementJobs)
            .set({
              attempts,
              completedAt: attempts >= 6 ? now : null,
              availableAt: new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** (attempts - 1))),
              leaseUntil: null,
              lastError: attempts >= 6 ? "SOURCE_RETRIES_EXHAUSTED" : "SOURCE_PROCESSING_FAILED",
            })
            .where(eq(engagementJobs.id, job.id));
        }
        jobsProcessed++;
      }
      return { jobsProcessed, inboxCreated };
    });
  }
  async function scanReminders(limit = 100) {
    const now = clock(),
      count = Math.min(500, Math.max(1, Math.floor(limit)));
    return db.transaction(async (tx) => {
      // A transaction-scoped lock bounds competing scans without keeping a process-local cache.
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(73412,29107) as acquired`);
      if (!rawRows<{ acquired?: boolean }>(lock)[0]?.acquired) return { remindersCreated: 0 };
      const candidates = await tx.execute(sql`with due as (
        select a.id application_id,a.post_id,a.user_id recipient_id,e.starts_at,coalesce(lifecycle.revision,0) revision,
          case when e.starts_at-${now.toISOString()}::timestamptz>interval '2 hours' then '24h' else '2h' end stage
        from sliper.event_applications a join sliper.room_members m on m.application_id=a.id and m.user_id=a.user_id and m.post_id=a.post_id
        join sliper.event_settings e on e.post_id=a.post_id left join sliper.event_lifecycle lifecycle on lifecycle.post_id=e.post_id
        where a.status='confirmed' and m.revoked_at is null and lifecycle.cancelled_at is null
          and e.starts_at>${now.toISOString()}::timestamptz and e.starts_at<=${now.toISOString()}::timestamptz+interval '24 hours'
          and m.created_at<=e.starts_at-case when e.starts_at-${now.toISOString()}::timestamptz>interval '2 hours' then interval '24 hours' else interval '2 hours' end
      ), candidate as (select due.*,
        'reminder:'||application_id::text||':'||floor(extract(epoch from starts_at)*1000)::bigint::text||':'||revision::text||':'||stage dedupe_key from due)
      select candidate.* from candidate where not exists(select 1 from sliper.inbox_items old where old.recipient_id=candidate.recipient_id and old.dedupe_key=candidate.dedupe_key)
        and ${engagementInboxEligibility({ recipientId: sql`candidate.recipient_id`, kind: sql`'reminders'`, postId: sql`candidate.post_id`, sourceId: sql`candidate.application_id`, dedupeKey: sql`candidate.dedupe_key`, createdAt: sql`${now.toISOString()}::timestamptz` }, { delivery: true, now: sql`${now.toISOString()}::timestamptz` })}
      order by candidate.starts_at,candidate.application_id limit ${count}`);
      let remindersCreated = 0;
      for (const row of rawRows<{
        application_id: string;
        post_id: string;
        recipient_id: string;
        starts_at: Date | string;
        dedupe_key: string;
      }>(candidates)) {
        const startsAt = new Date(row.starts_at);
        const item: typeof inboxItems.$inferInsert = {
          recipientId: row.recipient_id,
          postId: row.post_id,
          sourceId: row.application_id,
          dedupeKey: row.dedupe_key,
          kind: "reminders",
          title: titles.reminders,
          body:
            "시작 " +
            new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(startsAt),
          url: "/rooms/" + row.post_id,
          createdAt: now,
        };
        if ((await insertInbox(tx, item)).length) {
          remindersCreated++;
          await enqueueInboxPush(tx, item, startsAt);
        }
      }
      return { remindersCreated };
    });
  }
  async function drain(limit = 100) {
    const jobs = await processJobs(limit),
      reminders = await scanReminders(limit);
    return { ...jobs, ...reminders };
  }
  return { drain, processJobs, scanReminders };
}
