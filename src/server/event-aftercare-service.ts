import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { eventRecords, posts } from "../db/schema";
import {
  AFTERCARE_PAGE_SIZE,
  aftercareQuerySchema,
  type AftercareItem,
  type AftercarePage,
} from "../domain/event-aftercare";
import { creditMemberVisible } from "./event-credit-service";
import { recordVisible, requireRecordMember } from "./record-policy";
import { contentVisible } from "./safety-visibility";
import { canWriteVerifiedReview, participationAttended } from "./verified-review-policy";

type Row = {
  id: string;
  post_id: string;
  title: string;
  category: AftercareItem["category"];
  ends_at: string | null;
  role: AftercareItem["role"];
  stage: AftercareItem["stage"];
  pending: boolean;
  record_visible: boolean;
  pending_credits: number;
  correction_credits: number;
  own_pending: number;
  own_corrections: number;
  refunded: boolean;
  completed: boolean;
};
function item(row: Row, ownPublicId: string): AftercareItem {
  const eventHref = "/events/" + row.post_id;
  const managementHref = "/management/events/" + row.post_id;
  const recordHref = "/records/" + row.post_id;
  const actions: AftercareItem["actions"] = [];
  let label: string, description: string;
  if (row.role === "host" || row.role === "manager") {
    if (row.stage === "completion") {
      label = row.completed ? "기록 초안 확인 필요" : "종료 확인 필요";
      description = "참가 확인을 정리한 뒤 행사를 완료하면 기록 초안이 만들어져요.";
      actions.push({ label: "완료 확인하기", href: managementHref + "#event-completion" });
    } else {
      if (row.stage === "reflection") {
        label = "회고 작성 중";
        description = "기획 의도와 실제 진행, 잘된 점과 개선점을 기록하고 직접 발행해주세요.";
        actions.push({ label: "회고 작성하기", href: recordHref + "/edit" });
      } else if (row.stage === "credits") {
        label = row.correction_credits > 0 ? "제작 경력 정정 요청" : "제작진 수락 대기";
        description =
          row.correction_credits > 0
            ? "기여 내용 정정 요청 " +
              row.correction_credits +
              "건을 확인해주세요. 수락 대기 " +
              row.pending_credits +
              "건은 본인의 확인 후 경력에 반영돼요."
            : "기여 확인 요청 " +
              row.pending_credits +
              "건이 수락을 기다리고 있어요. 경력은 본인이 수락해야 반영돼요.";
      } else {
        label = row.record_visible ? "발행 완료 · 다음 행사 준비" : "행사 완료";
        description = row.record_visible
          ? "완료 기록에서 운영 자료를 개선하고 다음 행사를 준비해보세요."
          : "참가 전적과 제작진을 확인할 수 있어요. 회고 편집과 발행은 주최자가 맡아요.";
      }
      if (row.stage === "reflection" && row.pending_credits > 0)
        description += ` 제작진 확인 요청 ${row.pending_credits}건도 수락을 기다리고 있어요.`;
      if (row.stage === "reflection" && row.correction_credits > 0)
        description += " 제작 경력 정정 요청 " + row.correction_credits + "건을 확인해주세요.";
      actions.push({ label: "참가 전적 관리", href: managementHref + "#event-results" });
      actions.push({ label: "제작진 확인", href: managementHref + "#event-credits" });
      if (row.record_visible) actions.push({ label: "행사 기록 보기", href: recordHref });
    }
  } else if (row.role === "contributor") {
    if (row.own_pending > 0) {
      label = "제작 경력 확인 요청";
      description = `이 행사에서 받은 기여 확인 요청 ${row.own_pending}건을 확인하고 수락 여부를 선택해주세요.`;
    } else if (row.own_corrections > 0) {
      label = "제작 경력 정정 대기";
      description = "요청한 기여 내용의 정정을 담당자가 확인하고 있어요.";
    } else {
      label = "제작 경력 반영 완료";
      description = "수락한 제작 역할을 내 포트폴리오에서 확인할 수 있어요.";
    }
    actions.push({ label: "나의 기여 확인", href: "/players/me/credits" });
    if (row.record_visible) actions.push({ label: "행사 기록 보기", href: recordHref });
  } else {
    label = row.stage === "review" ? "참가 인증 후기 쓰기" : "나의 참가 기록";
    description =
      row.stage === "review"
        ? "QR 입장이 확인된 행사예요. 직접 경험한 내용을 인증 후기로 남겨주세요."
        : row.refunded
          ? "실제 참석한 기록은 환불 내역과 구분해서 보관돼요. 환불 후에는 새 인증 후기를 작성할 수 없어요."
          : row.completed
            ? "담당자가 확인한 참가 전적과 내가 작성한 후기를 확인해보세요."
            : "참가 경험을 확인할 수 있어요. 공식 전적에는 담당자의 행사 완료 확인이 필요해요.";
    if (row.stage === "review")
      actions.push({ label: "인증 후기 쓰기", href: eventHref + "#event-reviews" });
    actions.push({ label: "내 참가 전적 보기", href: "/players/" + ownPublicId });
    if (row.record_visible) actions.push({ label: "행사 기록 보기", href: recordHref });
    else actions.push({ label: "행사 보기", href: eventHref });
  }
  return {
    id: row.id,
    postId: row.post_id,
    title: row.title,
    category: row.category,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    role: row.role,
    stage: row.stage,
    label,
    description,
    actions,
    pending: row.pending,
  };
}

/** Read-only, current ACL first; completion, credit and review APIs remain the source of truth. */
export function eventAftercareService(db: Database) {
  return {
    async list(actor: string | null, input: unknown = {}): Promise<AftercarePage> {
      const user = await requireRecordMember(db, actor);
      const query = aftercareQuerySchema.parse(input);
      const [result] = await db.select({
        total: sql<number>`aftercare.total`,
        pendingTotal: sql<number>`aftercare.pending_total`,
        page: sql<number>`aftercare.page`,
        items: sql<Row[]>`aftercare.items`,
        ownPublicId: sql<string>`aftercare.own_public_id`,
      }).from(sql`(
        with eligible_events as (
          select ${posts.id} post_id, ${posts.authorId} host_id, ${posts.authorId}=${user}::uuid is_host,
            exists(select 1 from sliper.room_managers rm where rm.post_id=${posts.id} and rm.user_id=${user}::uuid) is_manager,
            case when s.completed_at is not null then coalesce(${eventRecords.snapshot}->>'title',${posts.title}) else ${posts.title} end title,
            case when s.completed_at is not null then coalesce(${eventRecords.snapshot}->>'category',${posts.categorySlug}::text) else ${posts.categorySlug}::text end category,
            case when s.completed_at is not null then coalesce(${eventRecords.snapshot}->>'endsAt',s.ends_at::text) else s.ends_at::text end ends_at,
            s.ends_at sort_ends_at, s.completed_at is not null completed,
            ${eventRecords.postId} record_id, ${eventRecords.status} record_status,
            ${recordVisible(user, true)} managed_record_visible,
            ${recordVisible(user)} record_visible,
            ${recordVisible(user, false, true)} credit_visible
          from ${posts}
          join sliper.event_settings s on s.post_id=${posts.id}
          left join ${eventRecords} on ${eventRecords.postId}=${posts.id}
          left join sliper.event_lifecycle l on l.post_id=${posts.id}
          where ${posts.kind}='모집' and ${posts.status}='published' and not ${posts.sample}
            and ${posts.authorId} is not null and l.cancelled_at is null
            and (s.completed_at is not null or s.ends_at<=statement_timestamp())
            and ${contentVisible("post", posts.id)} and ${contentVisible("record", posts.id)}
            and ${creditMemberVisible(user, posts.authorId)}
            and (${eventRecords.postId} is null or ${recordVisible(user, false, true)})
            and (${posts.authorId}=${user}::uuid
              or exists(select 1 from sliper.room_managers rm where rm.post_id=${posts.id} and rm.user_id=${user}::uuid)
              or exists(select 1 from sliper.event_applications a where a.post_id=${posts.id} and a.user_id=${user}::uuid)
              or exists(select 1 from sliper.event_credits c where c.post_id=${posts.id} and c.user_id=${user}::uuid))
        ), visible_credits as (
          select c.post_id,c.user_id,c.status
          from sliper.event_credits c join eligible_events e on e.post_id=c.post_id
          where e.credit_visible and ${creditMemberVisible(user, sql`c.user_id`)}
        ), credit_counts as (
          select post_id,
            count(*) filter(where status='correction_requested' and user_id<>${user}::uuid)::int correction_credits,
            count(*) filter(where status='pending' and user_id<>${user}::uuid)::int pending_credits,
            count(*) filter(where status='pending' and user_id=${user}::uuid)::int own_pending,
            count(*) filter(where status='correction_requested' and user_id=${user}::uuid)::int own_corrections,
            count(*) filter(where status in ('pending','accepted','correction_requested') and user_id=${user}::uuid)::int own_credits
          from visible_credits group by post_id
        ), base as (
          select e.*,coalesce(c.correction_credits,0) correction_credits,coalesce(c.pending_credits,0) pending_credits,coalesce(c.own_pending,0) own_pending,
            coalesce(c.own_corrections,0) own_corrections,coalesce(c.own_credits,0) own_credits
          from eligible_events e left join credit_counts c on c.post_id=e.post_id
        ), hosting as (
          select 'hosting:' || b.post_id::text id,b.post_id,b.title,b.category,b.ends_at,b.sort_ends_at,
            case when b.is_host then 'host' else 'manager' end role,
            case when not b.completed or b.record_id is null then 'completion'
              when b.is_host and coalesce(b.record_status,'draft')<>'published' then 'reflection'
              when b.pending_credits>0 or b.correction_credits>0 then 'credits' else 'ready' end stage,
            (not b.completed or b.record_id is null or (b.is_host and coalesce(b.record_status,'draft')<>'published') or b.pending_credits>0 or b.correction_credits>0) pending,
            b.record_visible,b.pending_credits,b.correction_credits,b.own_pending,b.own_corrections,false refunded,b.completed,'hosting' scope
          from base b where (b.is_host or b.is_manager) and (not b.completed or b.record_id is null or b.managed_record_visible)
        ), participation as (
          select 'participation:' || b.post_id::text id,b.post_id,b.title,b.category,b.ends_at,b.sort_ends_at,
            'participant' role,
            case when bool_or(${canWriteVerifiedReview({ applicationId: sql`a.id`, postId: sql`a.post_id`, userId: sql`a.user_id`, hostId: sql`b.host_id`, applicationStatus: sql`a.status`, endsAt: sql`b.sort_ends_at`, reviewPostId: sql`r.review_post_id` })}) then 'review' else 'ready' end stage,
            bool_or(${canWriteVerifiedReview({ applicationId: sql`a.id`, postId: sql`a.post_id`, userId: sql`a.user_id`, hostId: sql`b.host_id`, applicationStatus: sql`a.status`, endsAt: sql`b.sort_ends_at`, reviewPostId: sql`r.review_post_id` })}) pending,
            b.record_visible,b.pending_credits,b.correction_credits,b.own_pending,b.own_corrections,bool_or(a.status='refunded') refunded,b.completed,'participation' scope
          from base b join sliper.event_applications a on a.post_id=b.post_id and a.user_id=${user}::uuid
          left join sliper.verified_event_reviews r on r.application_id=a.id
          where not b.is_host and ${participationAttended({ applicationId: sql`a.id`, postId: sql`a.post_id`, userId: sql`a.user_id` })}
          group by b.post_id,b.title,b.category,b.ends_at,b.sort_ends_at,b.record_visible,b.pending_credits,b.correction_credits,b.own_pending,b.own_corrections,b.completed
        ), contributions as (
          select 'credits:' || b.post_id::text id,b.post_id,b.title,b.category,b.ends_at,b.sort_ends_at,'contributor' role,
            case when b.own_pending>0 or b.own_corrections>0 then 'credits' else 'ready' end stage,
            b.own_pending>0 pending,b.record_visible,b.pending_credits,b.correction_credits,b.own_pending,b.own_corrections,false refunded,b.completed,'credits' scope
          from base b where b.own_credits>0
        ), scoped as (
          select * from (select * from hosting union all select * from participation union all select * from contributions) combined
          where (${query.scope}='all' or scope=${query.scope})
        ), counts as (
          select count(*)::int all_total,count(*) filter(where pending)::int pending_total from scoped
        ), paging as (
          select case when ${query.view}='pending' then pending_total else all_total end total,pending_total,
            least(${query.page},greatest(1,ceil((case when ${query.view}='pending' then pending_total else all_total end)::numeric/${AFTERCARE_PAGE_SIZE})::int)) page from counts
        )
        select paging.*,coalesce(jsonb_agg(to_jsonb(selected) - 'sort_ends_at' - 'scope' order by selected.pending desc,selected.sort_ends_at desc nulls last,selected.id) filter(where selected.id is not null),'[]'::jsonb) items,
          (select public_id::text from sliper.profiles where id=${user}::uuid) own_public_id
        from paging left join lateral (
          select * from scoped where (${query.view}='all' or pending)
          order by pending desc,sort_ends_at desc nulls last,id
          limit ${AFTERCARE_PAGE_SIZE} offset (paging.page-1)*${AFTERCARE_PAGE_SIZE}
        ) selected on true group by paging.total,paging.pending_total,paging.page
      ) aftercare`);
      const total = Number(result?.total ?? 0);
      const page = Number(result?.page ?? 1);
      return {
        items: (result?.items ?? []).map((row) => item(row, result!.ownPublicId)),
        total,
        pendingTotal: Number(result?.pendingTotal ?? 0),
        page,
        hasMore: page * AFTERCARE_PAGE_SIZE < total && page < 1000,
      };
    },
  };
}
