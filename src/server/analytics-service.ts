import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { analyticsActivityDays, analyticsState } from "../db/analytics-schema";
import { profiles } from "../db/schema";
import { memberSafety, staffRoles } from "../db/safety-schema";
import { DAY_MS, koreanDay, koreanDayStart } from "../domain/community-time";
import { membershipActive } from "../domain/safety";
import { AppError, requireActor } from "./errors";
import { verifiedReviewParticipation } from "./verified-review-policy";
export type MetricsCounts = Record<
  | "registrations"
  | "excluded"
  | "action_denominator"
  | "activated"
  | "return_denominator"
  | "returned"
  | "repeat_members"
  | "applications"
  | "confirmations"
  | "completed_events"
  | "attended"
  | "qr_attended"
  | "manager_attended"
  | "record_denominator"
  | "published"
  | "verified_reviews"
  | "reused_events"
  | "question_denominator"
  | "answered_in_24h",
  number
>;
const localActor = "00000000-0000-4000-8000-000000000001";
export const metricsQuerySchema = z.strictObject({
  days: z.coerce
    .number()
    .refine((n) => n === 7 || n === 28)
    .default(7),
});
export function analyticsService(db: Database) {
  async function allowedAdmin(actor: string | null) {
    const userId = requireActor(actor);
    const [role] = await db.select().from(staffRoles).where(eq(staffRoles.userId, userId));
    const [safety] = await db.select().from(memberSafety).where(eq(memberSafety.userId, userId));
    if (role?.role !== "admin" || !membershipActive(safety))
      throw new AppError("FORBIDDEN", "관리자만 이용 현황을 확인할 수 있어요.");
  }
  async function collect(actor: string | null, now = new Date()) {
    if (!actor) return { collected: false };
    return db.transaction(async (tx) => {
      // The same profile lock serializes withdrawal and collection.
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, actor))
        .for("no key update");
      const [safety] = await tx.select().from(memberSafety).where(eq(memberSafety.userId, actor));
      const [staff] = await tx.select().from(staffRoles).where(eq(staffRoles.userId, actor));
      if (
        !profile ||
        profile.analyticsExcluded ||
        staff ||
        actor === localActor ||
        !membershipActive(safety)
      )
        return { collected: false };
      const day = koreanDay(now);
      const claimed = await tx
        .update(analyticsState)
        .set({ cleanedDay: day })
        .where(
          and(
            eq(analyticsState.id, 1),
            sql`${analyticsState.cleanedDay} is null or ${analyticsState.cleanedDay}<${day}::date`,
          ),
        )
        .returning({ id: analyticsState.id });
      if (claimed.length)
        await tx
          .delete(analyticsActivityDays)
          .where(
            sql`${analyticsActivityDays.day}<${koreanDay(new Date(now.getTime() - 89 * DAY_MS))}::date`,
          );
      await tx.insert(analyticsActivityDays).values({ userId: actor, day }).onConflictDoNothing();
      return { collected: true };
    });
  }
  async function summary(actor: string | null, input: unknown = {}, now = new Date()) {
    await allowedAdmin(actor);
    const { days } = metricsQuerySchema.parse(input);
    const start = new Date(koreanDayStart(now).getTime() - (days - 1) * DAY_MS).toISOString();
    const end = now.toISOString();
    // Compare fully observed signup cohorts; the current week has not had seven return days yet.
    const cohortEnd = new Date(koreanDayStart(now).getTime() - 7 * DAY_MS).toISOString();
    const cohortStart = new Date(Date.parse(cohortEnd) - days * DAY_MS).toISOString();
    const recordCohortStart = new Date(Date.parse(start) - 7 * DAY_MS).toISOString();
    const recordCohortEnd = new Date(now.getTime() - 7 * DAY_MS).toISOString();
    const [state] = await db.select().from(analyticsState).where(eq(analyticsState.id, 1));
    if (!state) throw new AppError("CONFLICT", "이용 현황 DB 준비가 필요해요.");
    // All aggregates share a statement snapshot. No member IDs or content leave this query.
    const result = await db.execute(sql`
      with members as (
        select p.id, p.created_at from sliper.profiles p
        where not p.analytics_excluded and p.id<>${localActor}::uuid
        and not exists(select 1 from sliper.staff_roles s where s.user_id=p.id)
        and not exists(select 1 from sliper.member_safety s where s.user_id=p.id and (s.status='closed' or (s.status='suspended' and (s.suspended_until is null or s.suspended_until>${end}::timestamptz))))
      ), questions as (
        select p.id,p.author_id,p.created_at from sliper.posts p join members m on m.id=p.author_id
        where p.kind='이야기' and p.discussion_type='question' and p.status='published' and not p.sample
        and p.created_at>=${start}::timestamptz and p.created_at<=${end}::timestamptz-interval '24 hours'
        and not exists(select 1 from sliper.content_restrictions r where r.target_type='post' and r.target_id=p.id and r.hidden)
      ), events as (
        select p.id, p.author_id, e.completed_at from sliper.posts p
        join sliper.event_settings e on e.post_id=p.id join members m on m.id=p.author_id
        where not p.sample and not exists(select 1 from sliper.event_lifecycle l where l.post_id=p.id and l.cancelled_at is not null)
      ), cohort as (
        select * from members where created_at>=${cohortStart}::timestamptz and created_at<${cohortEnd}::timestamptz
      ), returning_cohort as (
        select * from cohort where created_at>=${state.startedAt.toISOString()}::timestamptz
      ), actions as (
        select b.user_id, b.created_at from sliper.bookmarks b join sliper.posts p on p.id=b.post_id where not p.sample and p.status='published'
        union all select c.author_id, c.created_at from sliper.comments c join sliper.posts p on p.id=c.post_id where not p.sample and p.status='published' and c.status='published'
        union all select a.user_id, a.created_at from sliper.event_applications a join events e on e.id=a.post_id where a.source='site'
      ), completed as (
        select * from events where completed_at>=${start}::timestamptz and completed_at<${end}::timestamptz
      ), mature_completed as (
        select * from events where completed_at>=${recordCohortStart}::timestamptz and completed_at<${recordCohortEnd}::timestamptz
      ), attendance as (
        select r.post_id, r.user_id, exists(select 1 from sliper.event_admissions a where a.post_id=r.post_id and a.user_id=r.user_id) as qr
        from sliper.event_results r join completed e on e.id=r.post_id join members m on m.id=r.user_id where r.presence='attended'
      )
      select
        (select count(*)::int from questions) as question_denominator,
        (select count(*)::int from questions q where exists(select 1 from sliper.comments c join members m on m.id=c.author_id
          where c.post_id=q.id and c.author_id<>q.author_id and c.status='published' and c.created_at>=q.created_at and c.created_at<=q.created_at+interval '24 hours'
          and not exists(select 1 from sliper.content_restrictions r where r.target_type='comment' and r.target_id=c.id and r.hidden))) as answered_in_24h,
        (select count(*)::int from members where created_at>=${start}::timestamptz and created_at<${end}::timestamptz) as registrations,
        (select count(*)::int from sliper.profiles p where p.created_at>=${start}::timestamptz and p.created_at<${end}::timestamptz and not exists(select 1 from members m where m.id=p.id)) as excluded,
        (select count(*)::int from cohort) as action_denominator,
        (select count(*)::int from cohort c where exists(select 1 from actions a where a.user_id=c.id and a.created_at>=c.created_at and a.created_at<c.created_at+interval '7 days')) as activated,
        (select count(*)::int from returning_cohort) as return_denominator,
        (select count(*)::int from returning_cohort c where exists(select 1 from sliper.analytics_activity_days a where a.user_id=c.id and a.day between (c.created_at at time zone 'Asia/Seoul')::date+1 and (c.created_at at time zone 'Asia/Seoul')::date+7)) as returned,
        (select count(*)::int from (select a.user_id from sliper.analytics_activity_days a join members m on m.id=a.user_id where a.day>=${koreanDay(new Date(now.getTime() - 27 * DAY_MS))}::date and a.day<=${koreanDay(now)}::date group by a.user_id having count(*)>=2) r) as repeat_members,
        (select count(*)::int from sliper.event_applications a join events e on e.id=a.post_id join members m on m.id=a.user_id where a.created_at>=${start}::timestamptz and a.created_at<${end}::timestamptz) as applications,
        (select count(*)::int from sliper.event_applications a join events e on e.id=a.post_id join members m on m.id=a.user_id where a.confirmed_at>=${start}::timestamptz and a.confirmed_at<${end}::timestamptz) as confirmations,
        (select count(*)::int from completed) as completed_events,
        (select count(*)::int from attendance) as attended,
        (select count(*)::int from attendance where qr) as qr_attended,
        (select count(*)::int from attendance where not qr) as manager_attended,
        (select count(*)::int from mature_completed) as record_denominator,
        (select count(*)::int from mature_completed c join sliper.event_records r on r.post_id=c.id where r.status='published' and r.published_at between c.completed_at and c.completed_at+interval '7 days') as published,
        (select count(*)::int from sliper.verified_event_reviews r join events e on e.id=r.event_post_id join members m on m.id=r.user_id join sliper.posts p on p.id=r.review_post_id where p.status='published' and ${verifiedReviewParticipation({ applicationId: sql`r.application_id`, postId: sql`r.event_post_id`, userId: sql`r.user_id`, hostId: sql`e.author_id` })} and r.created_at>=${start}::timestamptz and r.created_at<${end}::timestamptz) as verified_reviews,
        (select count(distinct c.id)::int from completed c join sliper.template_provenance t on t.post_id=c.id join sliper.library_entries l on l.id=t.entry_id join members m on m.id=l.owner_id where not l.sample and l.owner_id<>c.author_id) as reused_events
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as unknown as { rows: Record<string, number>[] }).rows;
    return {
      days,
      start,
      end,
      collectionStartedAt: state.startedAt.toISOString(),
      signupCohort: { start: cohortStart, end: cohortEnd },
      recordCohort: { start: recordCohortStart, end: recordCohortEnd },
      retentionDays: 90,
      repeatCoverageComplete:
        state.startedAt.getTime() <=
        koreanDayStart(new Date(now.getTime() - 27 * DAY_MS)).getTime(),
      counts: rows[0] as unknown as MetricsCounts,
    };
  }
  return { summary, collect, allowedAdmin };
}
