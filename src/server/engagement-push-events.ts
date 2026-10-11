import { sql } from "drizzle-orm";
import type { EngagementConnection } from "./engagement-events";
import type { inboxItems } from "../db/engagement-schema";
export async function enqueueInboxPush(
  tx: EngagementConnection,
  item: typeof inboxItems.$inferInsert,
  expiresAt?: Date,
) {
  if (item.readAt || item.kind === "credits" || item.kind === "records") return;
  const kinds = {
    comments: "comment",
    announcements: "announcement",
    participation: "participation",
    subscriptions: "subscription",
    reminders: "reminder",
  } as const;
  const kind = kinds[item.kind];
  await tx.execute(sql`
    insert into sliper.push_deliveries(subscription_id,recipient_id,dedupe_key,kind,post_id,comment_id,title,body,url,expires_at)
    select s.id,s.user_id,${item.dedupeKey},${kind},${item.postId}::uuid,${kind === "comment" ? item.sourceId : null}::uuid,
      ${item.title},${item.kind === "reminders" ? item.body : "Sliper에서 내용을 확인해주세요."},${item.url},coalesce(${expiresAt?.toISOString() ?? null}::timestamptz,statement_timestamp()+interval '24 hours')
    from sliper.push_subscriptions s left join sliper.push_preferences pref on pref.user_id=s.user_id
    where s.user_id=${item.recipientId}::uuid and (s.expiration_time is null or s.expiration_time>statement_timestamp())
      and coalesce(case
        when ${kind}='comment' then pref.comments when ${kind}='announcement' then pref.announcements
        when ${kind}='participation' then pref.participation when ${kind}='subscription' then pref.subscriptions
        when ${kind}='reminder' then pref.reminders else true end,true)
    on conflict(subscription_id,dedupe_key) do nothing
  `);
}
