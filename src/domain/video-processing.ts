import type { PublicVideo } from "./contracts";

export const VIDEO_JOB_LEASE_SECONDS = 300;
export const VIDEO_JOB_MAX_ATTEMPTS = 3;
export const VIDEO_JOB_MAX_PENDING = 3;
export const VIDEO_SOURCE_TTL_SECONDS = 24 * 60 * 60;
export const VIDEO_UPLOAD_RESERVATION_SECONDS = 15 * 60;
export const VIDEO_OUTPUT_CLEANUP_DELAY_SECONDS = 60 * 60;
export type VideoJobStatus = "queued" | "processing" | "ready" | "failed";
export type VideoJobErrorCode = "UPLOAD_FAILED" | "INVALID_VIDEO" | "PROCESSING_FAILED" | "EXPIRED";
export interface QueuedVideoUpload {
  jobId: string;
  status: "queued";
  statusUrl: string;
}
export interface VideoJobView {
  jobId: string;
  status: VideoJobStatus;
  video: PublicVideo | null;
  error: string | null;
}
export function videoJobErrorMessage(code: VideoJobErrorCode | null): string {
  if (code === "INVALID_VIDEO")
    return "영상을 처리하지 못했어요. 3분 이하의 MP4·MOV·WebM 영상으로 다시 올려주세요.";
  if (code === "EXPIRED") return "영상 처리 대기 시간이 지났어요. 다시 올려주세요.";
  if (code === "UPLOAD_FAILED") return "영상 업로드를 완료하지 못했어요. 다시 올려주세요.";
  return "영상 처리를 완료하지 못했어요. 다시 올려주세요.";
}

export type VideoJobState = VideoJobStatus;
export type VideoUploadReceipt = QueuedVideoUpload;
export type VideoProcessingStatus = VideoJobView;
