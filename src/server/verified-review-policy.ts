import { sql, type SQL } from "drizzle-orm";

interface ParticipationIdentity {
  applicationId: SQL;
  postId: SQL;
  userId: SQL;
}
interface ReviewIdentity extends ParticipationIdentity {
  hostId: SQL;
}
export function hasQrAdmission(identity: ParticipationIdentity) {
  return sql<boolean>`exists(select 1 from sliper.event_admissions review_qr where review_qr.application_id=${identity.applicationId} and review_qr.post_id=${identity.postId} and review_qr.user_id=${identity.userId})`;
}
function recordedAttendance(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_results review_result where review_result.application_id=${identity.applicationId} and review_result.post_id=${identity.postId} and review_result.user_id=${identity.userId} and review_result.presence='attended')`;
}
function confirmedApplication(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_applications review_app where review_app.id=${identity.applicationId} and review_app.post_id=${identity.postId} and review_app.user_id=${identity.userId} and review_app.status='confirmed')`;
}
export function noShowCorrection(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_results review_correction where review_correction.application_id=${identity.applicationId} and review_correction.post_id=${identity.postId} and review_correction.user_id=${identity.userId} and review_correction.presence='no_show')`;
}

/** Current attendance is independent of payment status; an explicit correction overrides old QR evidence. */
export function participationAttended(identity: ParticipationIdentity): SQL<boolean> {
  return sql`(not ${noShowCorrection(identity)} and (${recordedAttendance(identity)} or ${hasQrAdmission(identity)}))`;
}

/**
 * Valid participation backing a published review. Confirmed participants of ended events and
 * lightning meetups qualify unless marked no_show; existing reviews from actual attendees survive
 * later refunds.
 */
export function verifiedReviewParticipation(
  identity: ReviewIdentity,
  options: { requireRecordedAttendance?: boolean } = {},
): SQL<boolean> {
  const attendanceEvidence = options.requireRecordedAttendance
    ? sql`(${recordedAttendance(identity)} or ${confirmedApplication(identity)})`
    : sql`(${hasQrAdmission(identity)} or ${recordedAttendance(identity)} or ${confirmedApplication(identity)})`;
  return sql`(${identity.userId} is distinct from ${identity.hostId} and not ${noShowCorrection(identity)} and ${attendanceEvidence})`;
}

/** New reviews require a confirmed, non-host, non-no_show application after the event ends. */
export function canWriteVerifiedReview(
  identity: ReviewIdentity & {
    applicationStatus: SQL;
    endsAt: SQL;
    completedAt?: SQL;
    reviewPostId: SQL;
    now?: SQL;
  },
): SQL<boolean> {
  const nowSql = identity.now ?? sql`statement_timestamp()`;
  const ended = identity.completedAt
    ? sql`(${identity.completedAt} is not null or ${identity.endsAt}<=${nowSql})`
    : sql`${identity.endsAt}<=${nowSql}`;
  return sql`coalesce((${identity.userId} is distinct from ${identity.hostId} and not ${noShowCorrection(identity)} and ${identity.applicationStatus}='confirmed' and ${ended} and ${identity.reviewPostId} is null),false)`;
}
