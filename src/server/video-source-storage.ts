import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageStorageBackend } from "../domain/image-storage";
import { VIDEO_UPLOAD_MAX_BYTES } from "../domain/video-compression";
import { imageStorageConfiguration } from "./image-storage-config";
import {
  localImageObjectStore,
  supabaseImageObjectStore,
  type ImageObjectStore,
  type SupabaseImageStorageApi,
} from "./image-storage-core";
import { AppError } from "./errors";

export interface VideoSourceStore {
  readonly backend: ImageStorageBackend;
  write(objectKey: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  read(objectKey: string, signal?: AbortSignal): Promise<Uint8Array>;
  remove(objectKey: string): Promise<void>;
}
export interface VideoProcessingStorage {
  sources(backend: ImageStorageBackend): VideoSourceStore;
  derivatives(backend: ImageStorageBackend): ImageObjectStore;
}
function sourceKey(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/.test(value))
    throw new AppError("NOT_FOUND", "영상 원본을 찾을 수 없어요.");
  return value;
}
function sourceSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > VIDEO_UPLOAD_MAX_BYTES)
    throw new AppError("VALIDATION", "영상은 50MB 이하로 올려주세요.");
}
export function localVideoSourceStore(workspace = process.cwd()): VideoSourceStore {
  function destination(objectKey: string) {
    const root = path.resolve(workspace, ".local", "video-sources");
    const file = path.resolve(root, sourceKey(objectKey));
    if (!file.startsWith(root + path.sep))
      throw new AppError("NOT_FOUND", "영상 원본을 찾을 수 없어요.");
    return { root, file };
  }
  return {
    backend: "local",
    async write(objectKey, bytes, signal) {
      const { root, file } = destination(objectKey);
      sourceSize(bytes.byteLength);
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(file, bytes, { flag: "wx", mode: 0o600, signal });
    },
    async read(objectKey, signal) {
      const { file } = destination(objectKey);
      const metadata = await stat(/* turbopackIgnore: true */ file);
      sourceSize(metadata.size);
      const bytes = await readFile(/* turbopackIgnore: true */ file, { signal });
      sourceSize(bytes.byteLength);
      return bytes;
    },
    async remove(objectKey) {
      await unlink(destination(objectKey).file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          throw new AppError("INTERNAL", "영상 원본을 정리하지 못했어요.");
      });
    },
  };
}
export function supabaseVideoSourceStore(
  api: SupabaseImageStorageApi,
  bucket: string,
): VideoSourceStore {
  function location(objectKey: string) {
    return "video-sources/" + sourceKey(objectKey);
  }
  async function privateBucket() {
    try {
      const response = await api.getBucket(bucket);
      if (response.error || response.data?.public !== false) throw new Error();
    } catch {
      throw new AppError("INTERNAL", "비공개 영상 저장소 설정을 확인해주세요.");
    }
  }
  return {
    backend: "supabase",
    async write(objectKey, bytes, signal) {
      const key = location(objectKey);
      sourceSize(bytes.byteLength);
      signal?.throwIfAborted();
      await privateBucket();
      const response = await api.from(bucket).upload(key, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
        cacheControl: "0",
      });
      if (response.error || !response.data)
        throw new AppError("INTERNAL", "영상 원본을 저장하지 못했어요.");
      signal?.throwIfAborted();
    },
    async read(objectKey, signal) {
      const key = location(objectKey);
      signal?.throwIfAborted();
      await privateBucket();
      const response = await api.from(bucket).download(key);
      if (response.error || !response.data)
        throw new AppError("INTERNAL", "영상 원본을 읽지 못했어요.");
      sourceSize(response.data.size);
      const bytes = new Uint8Array(await response.data.arrayBuffer());
      signal?.throwIfAborted();
      return bytes;
    },
    async remove(objectKey) {
      const key = location(objectKey);
      await privateBucket();
      const response = await api.from(bucket).remove([key]);
      if (response.error) throw new AppError("INTERNAL", "영상 원본을 정리하지 못했어요.");
    },
  };
}
function configuredStorage(backend?: ImageStorageBackend) {
  const config = imageStorageConfiguration(backend);
  if (config.backend === "local")
    return { source: localVideoSourceStore(), derivative: localImageObjectStore() };
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: init?.signal ?? AbortSignal.timeout(15000),
        }),
    },
  });
  return {
    source: supabaseVideoSourceStore(client.storage, config.bucket),
    derivative: supabaseImageObjectStore(client.storage, config.bucket),
  };
}
/** Private originals have no HTTP read route or signed/public URL. */
export function videoSourceStore(backend?: ImageStorageBackend): VideoSourceStore {
  return configuredStorage(backend).source;
}
export function videoProcessingStorage(): VideoProcessingStorage {
  const cache = new Map<ImageStorageBackend, ReturnType<typeof configuredStorage>>();
  function stores(backend: ImageStorageBackend) {
    let value = cache.get(backend);
    if (!value) {
      value = configuredStorage(backend);
      cache.set(backend, value);
    }
    return value;
  }
  return {
    sources: (backend) => stores(backend).source,
    derivatives: (backend) => stores(backend).derivative,
  };
}
