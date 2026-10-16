import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { mediaAssets } from "../db/schema";
import { engagementJobs } from "../db/engagement-schema";
import { pushDeliveries } from "../db/push-schema";
import { videoProcessingJobs, videoProcessingOutputs } from "../db/video-processing-schema";
import { videoAssets } from "../db/video-schema";
import { mediaRetentionJobs } from "../db/media-retention-schema";
import type { HealthQueue, OperationsHealth } from "../domain/operations-health";
import { analyticsService } from "./analytics-service";
import { imageStorageConfiguration } from "./image-storage-config";
import { isLocalPushDevelopment, pushConfiguration } from "./push-configuration";
import { parseRedisConfiguration } from "./redis-configuration";

export function healthConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): OperationsHealth["configuration"] {
  let mediaStorage: OperationsHealth["configuration"]["mediaStorage"] = "invalid";
  try {
    mediaStorage = imageStorageConfiguration(undefined, env).backend;
  } catch {
    /* Never return configuration errors or values. */
  }
  const rawRedis = env.REDIS_URL?.trim();
  const roomUpdates: OperationsHealth["configuration"]["roomUpdates"] = !rawRedis
    ? "disabled"
    : parseRedisConfiguration(rawRedis)
      ? "configured"
      : "invalid";
  const push = pushConfiguration(env)
    ? "configured"
    : env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY || env.VAPID_SUBJECT
      ? "invalid"
      : "disabled";
  const mode = env.PUSH_WORKER_MODE;
  const pushWorker =
    mode && !["embedded", "external"].includes(mode)
      ? "invalid"
      : mode === "embedded" ||
          (!mode && env.NODE_ENV === "development" && isLocalPushDevelopment(env))
        ? "embedded"
        : "external";
  return { mediaStorage, roomUpdates, push, pushWorker };
}

/** Administrative counters only. Reading this endpoint never drains, retries or deletes work. */
export function operationsHealthService(db: Database, env: NodeJS.ProcessEnv = process.env) {
  return {
    async snapshot(actor: string | null): Promise<OperationsHealth> {
      await analyticsService(db).allowedAdmin(actor);
      const checkedAt = new Date().toISOString();
      const now = sql`${checkedAt}::timestamptz`;
      const dueInbox = sql`${engagementJobs.completedAt} is null and ${engagementJobs.availableAt}<=${now} and (${engagementJobs.leaseUntil} is null or ${engagementJobs.leaseUntil}<=${now})`;
      const duePush = sql`${pushDeliveries.status}='pending' and ${pushDeliveries.availableAt}<=${now} and ${pushDeliveries.expiresAt}>${now}`;
      const dueVideo = sql`${videoProcessingJobs.status}='queued' and ${videoProcessingJobs.sourceReady} and ${videoProcessingJobs.availableAt}<=${now} and ${videoProcessingJobs.sourceExpiresAt}>${now}`;
      const [inbox, push, video, media] = await Promise.all([
        db
          .select({
            waiting: sql<number>`count(*) filter(where ${dueInbox})::int`,
            processing: sql<number>`count(*) filter(where ${engagementJobs.completedAt} is null and ${engagementJobs.leaseUntil}>${now})::int`,
            retrying: sql<number>`count(*) filter(where ${engagementJobs.completedAt} is null and ${engagementJobs.attempts}>0 and ${engagementJobs.lastError} is not null)::int`,
            failed: sql<number>`count(*) filter(where ${engagementJobs.completedAt} is not null and ${engagementJobs.lastError} is not null)::int`,
            staleLeases: sql<number>`count(*) filter(where ${engagementJobs.completedAt} is null and ${engagementJobs.leaseUntil}<=${now})::int`,
            oldestWaitingAt: sql<
              string | null
            >`min(${engagementJobs.availableAt}) filter(where ${dueInbox})::text`,
            latestCompletedAt: sql<
              string | null
            >`max(${engagementJobs.completedAt}) filter(where ${engagementJobs.lastError} is null)::text`,
          })
          .from(engagementJobs),
        db
          .select({
            waiting: sql<number>`count(*) filter(where ${duePush})::int`,
            processing: sql<number>`count(*) filter(where ${pushDeliveries.status}='processing' and ${pushDeliveries.lockedAt}>${now}-interval '120 seconds')::int`,
            retrying: sql<number>`count(*) filter(where ${pushDeliveries.status}='pending' and ${pushDeliveries.attempts}>0 and ${pushDeliveries.expiresAt}>${now})::int`,
            failed: sql<number>`count(*) filter(where ${pushDeliveries.status}='failed')::int`,
            staleLeases: sql<number>`count(*) filter(where ${pushDeliveries.status}='processing' and ${pushDeliveries.lockedAt}<=${now}-interval '120 seconds')::int`,
            oldestWaitingAt: sql<
              string | null
            >`min(${pushDeliveries.availableAt}) filter(where ${duePush})::text`,
            latestCompletedAt: sql<string | null>`max(${pushDeliveries.sentAt})::text`,
          })
          .from(pushDeliveries),
        db
          .select({
            waiting: sql<number>`count(*) filter(where ${dueVideo})::int`,
            processing: sql<number>`count(*) filter(where ${videoProcessingJobs.status}='processing' and ${videoProcessingJobs.leaseExpiresAt}>${now})::int`,
            retrying: sql<number>`count(*) filter(where ${videoProcessingJobs.status}='queued' and ${videoProcessingJobs.attempts}>0 and ${videoProcessingJobs.sourceExpiresAt}>${now} and ${videoProcessingJobs.sourceReady})::int`,
            failed: sql<number>`count(*) filter(where ${videoProcessingJobs.status}='failed')::int`,
            staleLeases: sql<number>`count(*) filter(where ${videoProcessingJobs.status}='processing' and ${videoProcessingJobs.leaseExpiresAt}<=${now})::int`,
            oldestWaitingAt: sql<
              string | null
            >`min(${videoProcessingJobs.availableAt}) filter(where ${dueVideo})::text`,
            latestCompletedAt: sql<
              string | null
            >`max(${videoProcessingJobs.updatedAt}) filter(where ${videoProcessingJobs.status}='ready')::text`,
          })
          .from(videoProcessingJobs),
        db
          .select({
            abandonedImages: sql<number>`(select count(*)::int from ${mediaAssets} observed where observed.post_id is null and observed.record_post_id is null and observed.record_origin_post_id is null and observed.unattached_since<${now}-interval '24 hours' and not exists(select 1 from ${mediaRetentionJobs} reserved where reserved.asset_kind='image' and reserved.asset_id=observed.id))`,
            abandonedVideos: sql<number>`(select count(*)::int from ${videoAssets} observed where observed.post_id is null and observed.record_post_id is null and observed.record_origin_post_id is null and observed.unattached_since<${now}-interval '24 hours' and not exists(select 1 from ${mediaRetentionJobs} reserved where reserved.asset_kind='video' and reserved.asset_id=observed.id))`,
            videoSourcesToClean: sql<number>`(select count(*)::int from ${videoProcessingJobs} where ${videoProcessingJobs.sourceRemovedAt} is null and ${videoProcessingJobs.sourceCleanupAt}<=${now} and (${videoProcessingJobs.status} in ('ready','failed') or ${videoProcessingJobs.sourceExpiresAt}<=${now} or (not ${videoProcessingJobs.sourceReady} and ${videoProcessingJobs.uploadExpiresAt}<=${now})))`,
            videoOutputsToClean: sql<number>`(select count(*)::int from ${videoProcessingOutputs} where ${videoProcessingOutputs.publishedAt} is null and ${videoProcessingOutputs.removedAt} is null and ${videoProcessingOutputs.cleanupAt}<=${now})`,
          })
          .from(sql`(select 1) observation`),
      ]);
      const queue = (
        key: HealthQueue["key"],
        label: string,
        row: Omit<HealthQueue, "key" | "label">,
      ): HealthQueue => ({
        key,
        label,
        waiting: Number(row.waiting),
        processing: Number(row.processing),
        retrying: Number(row.retrying),
        failed: Number(row.failed),
        staleLeases: Number(row.staleLeases),
        oldestWaitingAt: row.oldestWaitingAt ? new Date(row.oldestWaitingAt).toISOString() : null,
        latestCompletedAt: row.latestCompletedAt
          ? new Date(row.latestCompletedAt).toISOString()
          : null,
      });
      return {
        checkedAt,
        queues: [
          queue("inbox", "알림함 생성", inbox[0]!),
          queue("push", "기기 알림 발송", push[0]!),
          queue("video", "영상 변환", video[0]!),
        ],
        media: media[0]!,
        configuration: healthConfiguration(env),
      };
    },
  };
}
