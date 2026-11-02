import { sql, type SQLWrapper } from "drizzle-orm";
export function growthMemberVisible(user: SQLWrapper, viewer: SQLWrapper) {
  return sql`not exists(select 1 from sliper.member_safety s where s.user_id=${user} and (s.status='closed' or (s.status='suspended' and (s.suspended_until is null or s.suspended_until>statement_timestamp())))) and not exists(select 1 from sliper.member_blocks b where (b.blocker_id=${user} and b.blocked_id=${viewer}) or (b.blocked_id=${user} and b.blocker_id=${viewer}))`;
}
/** The query owns aliases gp (posts), ge (settings) and gs (saved search). */
export function savedSearchMatches() {
  return sql`
 (gs.settings->>'category' is null or gs.settings->>'category'=gp.category_slug::text)
 and (coalesce(gs.settings->>'region','')='' or position(lower(gs.settings->>'region') in lower(coalesce(gp.location,'')))>0)
 and (coalesce(gs.settings->>'keyword','')='' or position(lower(gs.settings->>'keyword') in lower(gp.title||' '||array_to_string(gp.tags,' ')))>0)
 and (gs.settings->>'meetupType'='all' or gs.settings->>'meetupType'=ge.meetup_type)
 and (gs.settings->>'maxPrice' is null or ge.amount_krw<=(gs.settings->>'maxPrice')::int)
 and (not (gs.settings->>'beginnerOnly')::boolean or ge.participant_guide->>'experience'='beginner')
 and (not (gs.settings->>'soloOnly')::boolean or ge.participant_guide->>'company' in ('solo','both'))`;
}
export function savedSearchEligible(
  user: SQLWrapper,
  postId: SQLWrapper,
  source: SQLWrapper,
  browse = false,
) {
  return sql`exists(select 1 from sliper.saved_searches gs join sliper.posts gp on gp.id=${postId} join sliper.event_settings ge on ge.post_id=gp.id where gs.id=${source} and gs.user_id=${user} and (${browse} or (gs.settings->>'frequency'<>'off' and gp.created_at>=gs.created_at)) and gp.kind='모집' and gp.status='published' and not gp.sample and gp.author_id<>gs.user_id and not gp.spoiler and ge.open and ge.completed_at is null and ge.starts_at>statement_timestamp() and not exists(select 1 from sliper.event_lifecycle l where l.post_id=gp.id and l.cancelled_at is not null) and not exists(select 1 from sliper.content_restrictions h where h.target_type='post' and h.target_id=gp.id and h.hidden) and ${growthMemberVisible(sql`gp.author_id`, user)} and ${savedSearchMatches()})`;
}
export function waitlistEligible(user: SQLWrapper, postId: SQLWrapper, source: SQLWrapper) {
  return sql`exists(select 1 from sliper.event_waitlist w join sliper.event_settings e on e.post_id=w.post_id where w.id=${source} and w.user_id=${user} and w.post_id=${postId} and w.state='offered' and w.offer_until>statement_timestamp() and e.open and e.completed_at is null and e.starts_at>statement_timestamp() and not exists(select 1 from sliper.event_lifecycle l where l.post_id=w.post_id and l.cancelled_at is not null))`;
}
