import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isImageStorageKey,
  type ImageStorageBackend,
  type ImageStorageKind,
  type StoredImageObject,
} from "../domain/image-storage";
import { AppError } from "./errors";

export interface ImageObjectStore {
  readonly backend: ImageStorageBackend;
  write(kind: ImageStorageKind, objectKey: string, bytes: Uint8Array): Promise<void>;
  read(kind: ImageStorageKind, objectKey: string): Promise<Uint8Array>;
  remove(kind: ImageStorageKind, objectKey: string): Promise<void>;
}
function key(kind: ImageStorageKind, objectKey: string) {
  if (
    (kind !== "post" && kind !== "profile" && kind !== "video") ||
    !isImageStorageKey(kind, objectKey)
  )
    throw new AppError("NOT_FOUND", "이미지 파일을 찾을 수 없어요.");
  return objectKey;
}
function size(kind: ImageStorageKind, bytes: number) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > (kind === "profile" ? 2 : kind === "video" ? 25 : 10) * 1024 * 1024
  )
    throw new AppError("INTERNAL", "이미지 파일을 저장하지 못했어요.");
}
export function localImageObjectStore(workspace = process.cwd()): ImageObjectStore {
  function destination(kind: ImageStorageKind, objectKey: string) {
    key(kind, objectKey);
    const root = path.resolve(
      workspace,
      ".local",
      kind === "post" ? "uploads" : kind === "video" ? "videos" : "profile-photos",
    );
    const file = path.resolve(root, objectKey);
    if (!file.startsWith(root + path.sep))
      throw new AppError("NOT_FOUND", "이미지 파일을 찾을 수 없어요.");
    return { root, file };
  }
  return {
    backend: "local",
    async write(kind, objectKey, bytes) {
      const { root, file } = destination(kind, objectKey);
      size(kind, bytes.byteLength);
      await mkdir(root, { recursive: true });
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    },
    async read(kind, objectKey) {
      const { file } = destination(kind, objectKey);
      // These are runtime uploads on a persistent volume, never build-time assets.
      const bytes = await readFile(/* turbopackIgnore: true */ file).catch(() => {
        throw new AppError("NOT_FOUND", "이미지 파일을 찾을 수 없어요.");
      });
      size(kind, bytes.byteLength);
      return bytes;
    },
    async remove(kind, objectKey) {
      const { file } = destination(kind, objectKey);
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          throw new AppError("INTERNAL", "이미지 파일을 정리하지 못했어요.");
      });
    },
  };
}
type StorageResponse<T> = { data: T | null; error: unknown };
export interface SupabaseImageStorageApi {
  getBucket(bucket: string): PromiseLike<StorageResponse<{ public: boolean }>>;
  from(bucket: string): {
    upload(
      path: string,
      bytes: Uint8Array,
      options: { contentType: string; upsert: boolean; cacheControl: string },
    ): PromiseLike<StorageResponse<unknown>>;
    download(path: string): PromiseLike<StorageResponse<Blob>>;
    remove(paths: string[]): PromiseLike<StorageResponse<unknown>>;
  };
}
/** No public/signed URLs are created: callers must authorize before read(). */
export function supabaseImageObjectStore(
  api: SupabaseImageStorageApi,
  bucket: string,
): ImageObjectStore {
  function objectPath(kind: ImageStorageKind, objectKey: string) {
    return `${kind === "post" ? "posts" : kind === "video" ? "videos" : "profiles"}/${key(kind, objectKey)}`;
  }
  async function privateBucket() {
    try {
      const response = await api.getBucket(bucket);
      if (response.error || response.data?.public !== false) throw new Error();
    } catch {
      throw new AppError("INTERNAL", "비공개 이미지 저장소 설정을 확인해주세요.");
    }
  }
  return {
    backend: "supabase",
    async write(kind, objectKey, bytes) {
      const location = objectPath(kind, objectKey);
      size(kind, bytes.byteLength);
      await privateBucket();
      try {
        const response = await api.from(bucket).upload(location, bytes, {
          contentType: kind === "video" ? "video/mp4" : "image/webp",
          upsert: false,
          cacheControl: "0",
        });
        if (response.error || !response.data) throw new Error();
      } catch {
        throw new AppError("INTERNAL", "이미지 파일을 저장하지 못했어요.");
      }
    },
    async read(kind, objectKey) {
      const location = objectPath(kind, objectKey);
      await privateBucket();
      try {
        const response = await api.from(bucket).download(location);
        if (response.error || !response.data) throw new Error();
        size(kind, response.data.size);
        return new Uint8Array(await response.data.arrayBuffer());
      } catch {
        throw new AppError("NOT_FOUND", "이미지 파일을 찾을 수 없어요.");
      }
    },
    async remove(kind, objectKey) {
      const location = objectPath(kind, objectKey);
      await privateBucket();
      try {
        const response = await api.from(bucket).remove([location]);
        if (response.error) throw new Error();
      } catch {
        throw new AppError("INTERNAL", "이미지 파일을 정리하지 못했어요.");
      }
    },
  };
}
/** Remove only the newly acknowledged object if metadata persistence rolls back. */
export async function persistImageObject<T>(
  store: ImageObjectStore,
  kind: ImageStorageKind,
  objectKey: string,
  bytes: Uint8Array,
  persist: (object: StoredImageObject) => Promise<T>,
  cleanupFailure: () => void = () => console.error("Sliper image cleanup failed."),
): Promise<T> {
  await store.write(kind, objectKey, bytes);
  try {
    return await persist({ objectKey, storageBackend: store.backend });
  } catch (error) {
    try {
      await store.remove(kind, objectKey);
    } catch {
      cleanupFailure();
    }
    throw error;
  }
}
