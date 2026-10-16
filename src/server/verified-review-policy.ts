import { sql, type SQL } from "drizzle-orm";

interface ParticipationIdentity {
  applicationId: SQL;
  postId: SQL;
  userId: SQL;
}
interface ReviewIdentity extends ParticipationIdentity {
  hostId: SQL;
}
function qrAdmission(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_admissions review_qr where review_qr.application_id=${identity.applicationId} and review_qr.post_id=${identity.postId} and review_qr.user_id=${identity.userId})`;
}
function recordedAttendance(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_results review_result where review_result.application_id=${identity.applicationId} and review_result.post_id=${identity.postId} and review_result.user_id=${identity.userId} and review_result.presence='attended')`;
}
function noShowCorrection(identity: ParticipationIdentity) {
  return sql`exists(select 1 from sliper.event_results review_correction where review_correction.application_id=${identity.applicationId} and review_correction.post_id=${identity.postId} and review_correction.user_id=${identity.userId} and review_correction.presence='no_show')`;
}

/** Current attendance is independent of payment status; an explicit correction overrides old QR evidence. */
export function participationAttended(identity: ParticipationIdentity): SQL<boolean> {
  return sql`(not ${noShowCorrection(identity)} and (${recordedAttendance(identity)} or ${qrAdmission(identity)}))`;
}

/** Certification can precede formal completion; completed-record aggregates may require the recorded result. */
export function verifiedReviewParticipation(
  identity: ReviewIdentity,
  options: { requireRecordedAttendance?: boolean } = {},
): SQL<boolean> {
  return sql`(${identity.userId} is distinct from ${identity.hostId} and ${qrAdmission(identity)} and not ${noShowCorrection(identity)} ${options.requireRecordedAttendance ? sql`and ${recordedAttendance(identity)}` : sql``})`;
}

/** New reviews keep the existing confirmed-payment rule; already written reviews retain their attendance evidence after a refund. */
export function canWriteVerifiedReview(
  identity: ReviewIdentity & {
    applicationStatus: SQL;
    endsAt: SQL;
    reviewPostId: SQL;
    now?: SQL;
  },
): SQL<boolean> {
  return sql`coalesce((${verifiedReviewParticipation(identity)} and ${identity.applicationStatus}='confirmed' and ${identity.endsAt}<=${identity.now ?? sql`statement_timestamp()`} and ${identity.reviewPostId} is null),false)`;
}
