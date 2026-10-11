import { sql } from "drizzle-orm";
import type { Transaction } from "./activity";

export async function enqueueCommentPush(
  tx: Transaction,
  input: {
    postId: string;
    commentId: string;
    actorId: string;
    recipients: string[];
  },
) {
  const recipients = [...new Set(input.recipients)].filter((id) => id !== input.actorId);
  if (!recipients.length) return;
  await tx.execute(sql`
    insert into sliper.push_deliveries
      (subscription_id,recipient_id,dedupe_key,kind,post_id,comment_id,title,body,url)
    select s.id,s.user_id,${"comment:" + input.commentId},'comment',${input.postId}::uuid,${input.commentId}::uuid,
      '새 댓글·답글이 도착했어요','Sliper에서 댓글을 확인해주세요.',${"/?post=" + input.postId}
    from sliper.push_subscriptions s
    left join sliper.push_preferences pref on pref.user_id=s.user_id
    where s.user_id in (${sql.join(
      recipients.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and coalesce(pref.comments,true)
      and (s.expiration_time is null or s.expiration_time>statement_timestamp())
      and exists(select 1 from sliper.notifications n where n.recipient_id=s.user_id and n.comment_id=${input.commentId}::uuid)
    on conflict(subscription_id,dedupe_key) do nothing
  `);
}
export async function enqueueAnnouncementPush(
  tx: Transaction,
  input: {
    postId: string;
    messageId: string;
    actorId: string;
  },
) {
  // One INSERT SELECT fans out to opted-in current members and other managers.
  // No external network requests or full message text enter this transaction.
  await tx.execute(sql`
    insert into sliper.push_deliveries
      (subscription_id,recipient_id,dedupe_key,kind,post_id,title,body,url)
    select s.id,s.user_id,${"room:" + input.messageId},'announcement',p.id,
      '공지방에 새 공지가 올라왔어요','Sliper 공지방에서 내용을 확인해주세요.',${"/rooms/" + input.postId}
    from sliper.push_subscriptions s
    join sliper.posts p on p.id=${input.postId}::uuid and p.status='published'
    left join sliper.push_preferences pref on pref.user_id=s.user_id
    where s.user_id<>${input.actorId}::uuid and coalesce(pref.announcements,true)
      and (s.expiration_time is null or s.expiration_time>statement_timestamp())
      and (
        p.author_id=s.user_id
        or exists(select 1 from sliper.room_managers mgr where mgr.post_id=p.id and mgr.user_id=s.user_id)
        or exists(select 1 from sliper.room_members m join sliper.event_applications a on a.id=m.application_id
          where m.post_id=p.id and m.user_id=s.user_id and m.revoked_at is null and a.status='confirmed')
      )
    on conflict(subscription_id,dedupe_key) do nothing
  `);
}
