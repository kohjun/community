import { AppError } from "./errors";
import type { FileHandle } from "node:fs/promises";

export interface ObjectByteRange {
  start: number;
  end: number;
  total: number;
}
export type ObjectRangeReader = (
  location: string,
  range: ObjectByteRange,
  signal?: AbortSignal,
) => Promise<ReadableStream<Uint8Array>>;

export function assertObjectByteRange(range: ObjectByteRange) {
  if (
    !Number.isSafeInteger(range.total) ||
    range.total < 1 ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end >= range.total
  )
    throw new AppError("INTERNAL", "영상 파일을 확인하지 못했어요.");
}
const failed = () => new AppError("INTERNAL", "영상 파일을 확인하지 못했어요.");

/** Bounded pulls avoid reading the rest of a file when the client seeks or disconnects. */
export async function localObjectRangeStream(
  file: Pick<FileHandle, "stat" | "read" | "close">,
  range: ObjectByteRange,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    await file.close().catch(() => {});
  };
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const abort = () => {
    if (closed) return;
    streamController.error(new DOMException("The request was aborted.", "AbortError"));
    void close();
  };
  try {
    assertObjectByteRange(range);
    signal?.throwIfAborted();
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size !== range.total) throw failed();
    signal?.throwIfAborted();
  } catch (error) {
    await close();
    throw signal?.aborted ? new DOMException("The request was aborted.", "AbortError") : failed();
  }
  let position = range.start;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      },
      async pull(controller) {
        if (closed) return;
        try {
          const bytes = new Uint8Array(Math.min(64 * 1024, range.end - position + 1));
          const { bytesRead } = await file.read(bytes, 0, bytes.byteLength, position);
          if (closed) return;
          if (bytesRead < 1) throw failed();
          position += bytesRead;
          controller.enqueue(bytes.subarray(0, bytesRead));
          if (position > range.end) {
            controller.close();
            await close();
          }
        } catch {
          if (!closed) controller.error(failed());
          await close();
        }
      },
      async cancel() {
        await close();
      },
    },
    { highWaterMark: 0 },
  );
}

/** Upstream metadata and actual chunks must both match the requested representation. */
export function exactObjectRangeStream(
  source: ReadableStream<Uint8Array>,
  length: number,
  signal?: AbortSignal,
  release: () => void = () => {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let received = 0,
    closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const close = async (cancel: boolean) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    if (cancel) await reader.cancel().catch(() => {});
    reader.releaseLock();
    release();
  };
  const abort = () => {
    if (closed) return;
    streamController.error(new DOMException("The request was aborted.", "AbortError"));
    void close(true);
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      },
      async pull(controller) {
        if (closed) return;
        try {
          const chunk = await reader.read();
          if (closed) return;
          if (chunk.done) {
            if (received !== length) throw failed();
            controller.close();
            await close(false);
            return;
          }
          if (chunk.value.byteLength > length - received) throw failed();
          received += chunk.value.byteLength;
          controller.enqueue(chunk.value);
        } catch {
          if (!closed) controller.error(failed());
          await close(true);
        }
      },
      async cancel() {
        await close(true);
      },
    },
    { highWaterMark: 0 },
  );
}

/** Private authenticated Storage GETs stay on the server; Range is never emulated by a full download. */
export function supabaseObjectRangeReader(
  config: { url: string; bucket: string; secretKey: string },
  fetcher: typeof fetch = fetch,
): ObjectRangeReader {
  return async (location, range, signal) => {
    assertObjectByteRange(range);
    const upstream = new AbortController();
    const combined = AbortSignal.any([
      upstream.signal,
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]);
    let response: Response | undefined;
    try {
      const object = location.split("/").map(encodeURIComponent).join("/");
      response = await fetcher(
        `${config.url}/storage/v1/object/authenticated/${encodeURIComponent(config.bucket)}/${object}`,
        {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          signal: combined,
          headers: {
            apikey: config.secretKey,
            Authorization: `Bearer ${config.secretKey}`,
            Range: `bytes=${range.start}-${range.end}`,
            "Accept-Encoding": "identity",
          },
        },
      );
      const length = range.end - range.start + 1;
      if (
        response.status !== 206 ||
        !response.body ||
        response.headers.get("content-range") !==
          `bytes ${range.start}-${range.end}/${range.total}` ||
        response.headers.get("content-length") !== String(length) ||
        ![null, "identity"].includes(response.headers.get("content-encoding"))
      )
        throw failed();
      return exactObjectRangeStream(response.body, length, combined, () => upstream.abort());
    } catch {
      upstream.abort();
      await response?.body?.cancel().catch(() => {});
      throw signal?.aborted ? new DOMException("The request was aborted.", "AbortError") : failed();
    }
  };
}
