import { sql } from "drizzle-orm";
import { posts } from "../db/schema";
import type { CommunityPost } from "../domain/community";
import type { PublicImage, PublicVideo } from "../domain/contracts";
import { verifiedReviewParticipation } from "./verified-review-policy";

/** Correlated, indexed reads travel with their authorized parent rows in one DB round trip. */
export function postMetadataColumns(actor: string | null) {
  return {
    images: sql<PublicImage[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'src','/api/media/'||m.id::text,'contentType',m.content_type,'sortOrder',m.sort_order
    ) order by m.sort_order) from sliper.media_assets m where m.post_id=${posts.id} and m.status='ready'),'[]'::jsonb)`,
    attachedVideos: sql<PublicVideo[]>`coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'src','/api/videos/'||v.id::text,'contentType','video/mp4','byteSize',v.byte_size,
      'width',v.width,'height',v.height,'durationSeconds',v.duration_seconds,'sortOrder',v.sort_order
    ) order by v.sort_order) from sliper.video_assets v where v.post_id=${posts.id} and v.status='ready'),'[]'::jsonb)`,
    voteCounts: sql<
      { index: number; count: number }[]
    >`case when ${posts.poll} is null then '[]'::jsonb else
      coalesce((select jsonb_agg(jsonb_build_object('index',totals.option_index,'count',totals.count)) from
        (select pv.option_index,count(*)::int as count from sliper.poll_votes pv where pv.post_id=${posts.id} group by pv.option_index) totals),'[]'::jsonb) end`,
    selectedVote: actor
      ? sql<
          number | null
        >`(select pv.option_index from sliper.poll_votes pv where pv.post_id=${posts.id} and pv.user_id=${actor})`
      : sql<null>`null::integer`,
    verifiedParticipation: sql<NonNullable<
      CommunityPost["verifiedParticipation"]
    > | null>`(select jsonb_build_object(
      'eventPostId',vr.event_post_id,
      'eventTitle',case when exists(select 1 from sliper.posts e where e.id=vr.event_post_id and e.status='published' and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=e.id and cr.hidden)) then vr.event_title else '참가한 행사' end,
      'rating',vr.rating,'templateEntryId',vr.template_entry_id,
      'hostPublicId',case when exists(select 1 from sliper.posts e where e.id=vr.event_post_id and not e.is_anonymous and e.status='published' and not exists(select 1 from sliper.content_restrictions cr where cr.target_type='post' and cr.target_id=e.id and cr.hidden)) then (select p.public_id::text from sliper.profiles p where p.id=vr.host_id) else null end
    ) from sliper.verified_event_reviews vr where vr.review_post_id=${posts.id} and ${verifiedReviewParticipation(
      {
        applicationId: sql`vr.application_id`,
        postId: sql`vr.event_post_id`,
        userId: sql`vr.user_id`,
        hostId: sql`vr.host_id`,
      },
    )})`,
  };
}
