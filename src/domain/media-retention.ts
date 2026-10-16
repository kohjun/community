export const UNATTACHED_MEDIA_RETENTION_DAYS = 30;
export const MEDIA_RETENTION_BATCH_SIZE = 50;
export const MEDIA_RETENTION_MAX_ATTEMPTS = 5;
export const MEDIA_RETENTION_LEASE_SECONDS = 120;
export const MEDIA_RETENTION_POLICY = "unattached-v1";
export interface MediaRetentionSummary {
  checkedAt: string;
  retentionDays: number;
  eligibleImages: number;
  eligibleVideos: number;
  queued: number;
  processing: number;
  failed: number;
  removed: number;
}
export type RetentionAssetKind = "image" | "video";
