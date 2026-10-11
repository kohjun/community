import { appRequest } from "./api-client";
import type { PublicVideo } from "../domain/contracts";
import type { QueuedVideoUpload, VideoJobView } from "../domain/video-processing";
import { acceptsVideoUpload } from "../domain/video-compression";

export type VideoUploadStage = "uploading" | "queued" | "processing";
export interface VideoUploadOptions {
  signal?: AbortSignal;
  onProgress?: (stage: VideoUploadStage) => void;
}
type JobRequest = <T>(
  url: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs?: number,
) => Promise<T>;
export interface VideoUploadTransport {
  request: JobRequest;
  wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("취소했어요.", "AbortError");
}
function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("취소했어요.", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function readyVideo(value: PublicVideo | null): PublicVideo {
  if (
    !value ||
    !uuid.test(value.id) ||
    value.src !== "/api/videos/" + value.id ||
    value.contentType !== "video/mp4" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > 25 * 1024 * 1024 ||
    !Number.isInteger(value.width) ||
    value.width < 1 ||
    value.width > 1920 ||
    !Number.isInteger(value.height) ||
    value.height < 1 ||
    value.height > 1920 ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds <= 0 ||
    value.durationSeconds > 180 ||
    !Number.isInteger(value.sortOrder) ||
    value.sortOrder < 0 ||
    value.sortOrder > 2
  )
    throw new Error("영상 처리 결과를 확인하지 못했어요.");
  return value;
}
/** Polls only the owner's local status endpoint; processing continues in a separate worker. */
export async function uploadVideoFile(
  file: File,
  options: VideoUploadOptions = {},
  transport: VideoUploadTransport = { request: appRequest, wait, now: Date.now },
): Promise<PublicVideo> {
  cancelled(options.signal);
  if (!acceptsVideoUpload(file.type, file.size))
    throw new Error("50MB 이하의 MP4·MOV·WebM 영상을 선택해주세요.");
  const form = new FormData();
  form.set("file", file);
  options.onProgress?.("uploading");
  const receipt = await transport.request<QueuedVideoUpload>(
    "/api/videos",
    "POST",
    form,
    options.signal,
    120000,
  );
  if (!receipt || !uuid.test(receipt.jobId) || receipt.status !== "queued")
    throw new Error("영상 접수 결과를 확인하지 못했어요.");
  cancelled(options.signal);
  options.onProgress?.("queued");
  const deadline = transport.now() + 15 * 60 * 1000;
  let interval = 1500;
  while (transport.now() < deadline) {
    cancelled(options.signal);
    // Do not trust or fetch a URL returned by an upload response.
    const result = await transport.request<VideoJobView>(
      "/api/videos/jobs/" + receipt.jobId,
      "GET",
      undefined,
      options.signal,
      25000,
    );
    cancelled(options.signal);
    if (
      !result ||
      result.jobId !== receipt.jobId ||
      !["queued", "processing", "ready", "failed"].includes(result.status)
    )
      throw new Error("영상 처리 상태를 확인하지 못했어요.");
    if (result.status === "ready") return readyVideo(result.video);
    if (result.status === "failed")
      throw new Error(
        (typeof result.error === "string" ? result.error.slice(0, 250) : "") ||
          "영상을 처리하지 못했어요. 다른 영상으로 다시 시도해주세요.",
      );
    options.onProgress?.(result.status);
    await transport.wait(interval, options.signal);
    interval = Math.min(5000, interval + 500);
  }
  throw new Error("영상 처리 대기가 길어지고 있어요. 잠시 후 다시 시도해주세요.");
}
