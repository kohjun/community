import { sql, type SQLWrapper } from "drizzle-orm";
export interface InboxEligibilityFields {
  recipientId: SQLWrapper;
  kind: SQLWrapper;
  postId: SQLWrapper;
  sourceId: SQLWrapper;
  dedupeKey: SQLWrapper;
  createdAt: SQLWrapper;
}
// Source state is shared by inbox reads and delivery validation; no payload grants access.
export function engagementInboxEligibility(
  item: InboxEligibilityFields,
  options: { delivery?: boolean; now?: SQLWrapper } = {},
) {
  const now = options.now ?? sql`statement_timestamp()`;
  const reminderWindow = options.delivery
    ? sql`and (
    (${item.dedupeKey} like '%:24h' and e.starts_at-${now}::timestamptz > interval '2 hours' and e.starts_at-${now}::timestamptz <= interval '24 hours')
    or (${item.dedupeKey} like '%:2h' and e.starts_at>${now}::timestamptz and e.starts_at-${now}::timestamptz <= interval '2 hours')
  )`
    : sql``;
  return sql`
    not exists(select 1 from sliper.member_safety state where state.user_id=${item.recipientId}
      and (state.status='closed' or (state.status='suspended' and (state.suspended_until is null or state.suspended_until>${now}::timestamptz))))
    and exists(select 1 from sliper.posts p where p.id=${item.postId} and p.status='published'
      and not exists(select 1 from sliper.content_restrictions restriction where restriction.target_type='post' and restriction.target_id=p.id and restriction.hidden)
      and not exists(select 1 from sliper.member_blocks block
        where (block.blocker_id=${item.recipientId} and block.blocked_id=p.author_id)
          or (block.blocked_id=${item.recipientId} and block.blocker_id=p.author_id))
      and (
        (${item.kind}='comments' and exists(select 1 from sliper.notifications n join sliper.comments c on c.id=n.comment_id and c.post_id=n.post_id
          where n.recipient_id=${item.recipientId} and n.post_id=p.id and n.comment_id=${item.sourceId} and c.status='published'
            and not exists(select 1 from sliper.content_restrictions restriction where restriction.target_type='comment' and restriction.target_id=c.id and restriction.hidden)
            and not exists(select 1 from sliper.member_blocks block
              where (block.blocker_id=${item.recipientId} and block.blocked_id=c.author_id)
                or (block.blocked_id=${item.recipientId} and block.blocker_id=c.author_id))))
        or (${item.kind}='announcements' and exists(select 1 from sliper.room_messages message
          where message.id=${item.sourceId} and message.post_id=p.id and message.author_id is distinct from ${item.recipientId}
            and not exists(select 1 from sliper.member_blocks block where (block.blocker_id=${item.recipientId} and block.blocked_id=message.author_id) or (block.blocker_id=message.author_id and block.blocked_id=${item.recipientId}))
            and (p.author_id=${item.recipientId}
              or exists(select 1 from sliper.room_managers mgr where mgr.post_id=p.id and mgr.user_id=${item.recipientId})
              or exists(select 1 from sliper.room_members m join sliper.event_applications a on a.id=m.application_id
                where m.post_id=p.id and m.user_id=${item.recipientId} and m.revoked_at is null and m.created_at<=message.created_at and a.status='confirmed'))))
        or (${item.kind}='participation' and (
          (${item.dedupeKey} like 'application:%' and exists(select 1 from sliper.event_applications a
            where a.id=${item.sourceId} and a.user_id=${item.recipientId} and a.post_id=p.id))
          or (${item.dedupeKey} like 'event-change:%' and exists(select 1 from sliper.event_change_recipients r
            where r.change_id=${item.sourceId} and r.user_id=${item.recipientId} and r.post_id=p.id))))
        or (${item.kind}='credits' and exists(select 1 from sliper.event_credits credit join sliper.event_settings es on es.post_id=credit.post_id left join sliper.event_lifecycle lc on lc.post_id=credit.post_id
 where credit.id=${item.sourceId} and credit.post_id=p.id and credit.user_id=${item.recipientId} and es.completed_at is not null and not p.sample
 and not exists(select 1 from sliper.member_safety owner where owner.user_id=p.author_id and (owner.status='closed' or (owner.status='suspended' and (owner.suspended_until is null or owner.suspended_until>${now}::timestamptz))))
 and not exists(select 1 from sliper.member_blocks b where (b.blocker_id=${item.recipientId} and b.blocked_id=credit.confirmed_by) or (b.blocked_id=${item.recipientId} and b.blocker_id=credit.confirmed_by)) and lc.cancelled_at is null
 and not exists(select 1 from sliper.content_restrictions hidden where hidden.target_type='record' and hidden.target_id=p.id and hidden.hidden)))
        or (${item.kind}='records' and exists(select 1 from sliper.event_records rec join sliper.event_settings es on es.post_id=rec.post_id where rec.post_id=p.id and rec.status='published'
 and not exists(select 1 from sliper.event_lifecycle cancel where cancel.post_id=p.id and cancel.cancelled_at is not null)
 and not exists(select 1 from sliper.member_safety owner where owner.user_id=rec.owner_id and (owner.status='closed' or (owner.status='suspended' and (owner.suspended_until is null or owner.suspended_until>${now}::timestamptz)))) and es.completed_at is not null and not p.sample
 and not exists(select 1 from sliper.content_restrictions hidden where hidden.target_type='record' and hidden.target_id=p.id and hidden.hidden)))
        or (${item.kind}='subscriptions' and p.kind='모집' and not p.sample and p.author_id<>${item.recipientId}
          and exists(select 1 from sliper.event_settings e left join sliper.event_lifecycle lifecycle on lifecycle.post_id=e.post_id
            where e.post_id=p.id and e.open and lifecycle.cancelled_at is null and (e.starts_at is null or e.starts_at>${now}::timestamptz))
          and not exists(select 1 from sliper.member_safety host where host.user_id=p.author_id and (host.status='closed'
            or (host.status='suspended' and (host.suspended_until is null or host.suspended_until>${now}::timestamptz))))
          and (exists(select 1 from sliper.category_subscriptions category where category.user_id=${item.recipientId}
            and category.category_slug=p.category_slug::text and category.created_at<=p.created_at)
            or (not p.is_anonymous and exists(select 1 from sliper.host_subscriptions host where host.user_id=${item.recipientId}
              and host.host_id=p.author_id and host.created_at<=p.created_at))))
        or (${item.kind}='reminders' and exists(select 1 from sliper.event_applications a
          join sliper.room_members m on m.application_id=a.id and m.user_id=a.user_id and m.post_id=a.post_id
          join sliper.event_settings e on e.post_id=a.post_id left join sliper.event_lifecycle lifecycle on lifecycle.post_id=e.post_id
          where a.id=${item.sourceId} and a.post_id=p.id and a.user_id=${item.recipientId} and a.status='confirmed'
            and m.revoked_at is null and lifecycle.cancelled_at is null
            and not exists(select 1 from sliper.refund_requests refund where refund.application_id=a.id and refund.state='pending')
            and ${item.dedupeKey} = 'reminder:' || a.id::text || ':' || floor(extract(epoch from e.starts_at)*1000)::bigint::text
              || ':' || coalesce(lifecycle.revision,0)::text || ':' || case when ${item.dedupeKey} like '%:24h' then '24h' else '2h' end
            and m.created_at<=e.starts_at-case when ${item.dedupeKey} like '%:24h' then interval '24 hours' else interval '2 hours' end
            ${reminderWindow}))
      ))`;
}
