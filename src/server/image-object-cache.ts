import type { ImageObjectStore } from "./image-storage-core";
import type { ImageStorageKind } from "../domain/image-storage";
import { isImageStorageKey } from "../domain/image-storage";
import { AppError } from "./errors";
import { BoundedCache } from "./bounded-cache";
const runtime = globalThis as unknown as { sliperImageBytes?: BoundedCache<Uint8Array> };
const cache = (runtime.sliperImageBytes ??= new BoundedCache<Uint8Array>({
  maxEntries: 256,
  maxBytes: 32 * 1024 * 1024,
  maxPending: 32,
  size: (b) => b.byteLength,
}));
/** Bytes are reusable; permission to receive them is always checked by media routes first. */
export function cachedImageObjectStore(
  store: ImageObjectStore,
  namespace: string,
): ImageObjectStore {
  function key(kind: ImageStorageKind, objectKey: string) {
    if (!isImageStorageKey(kind, objectKey))
      throw new AppError("NOT_FOUND", "이미지 파일을 찾을 수 없어요.");
    return JSON.stringify([namespace, store.backend, kind, objectKey]);
  }
  return {
    backend: store.backend,
    async read(kind, objectKey) {
      if (kind === "video") return store.read(kind, objectKey);
      const value = await cache.read(key(kind, objectKey), 5 * 60_000, () =>
        store.read(kind, objectKey),
      );
      return value.slice(); // Callers cannot mutate the stored bytes.
    },
    async readRange(kind, objectKey, range, signal) {
      key(kind, objectKey);
      if (!store.readRange) throw new AppError("INTERNAL", "영상 파일을 확인하지 못했어요.");
      return store.readRange(kind, objectKey, range, signal);
    },
    async write(kind, objectKey, bytes) {
      const id = key(kind, objectKey);
      cache.delete(id);
      try {
        await store.write(kind, objectKey, bytes);
      } finally {
        cache.delete(id);
      }
    },
    async remove(kind, objectKey) {
      const id = key(kind, objectKey);
      cache.delete(id);
      try {
        await store.remove(kind, objectKey);
      } finally {
        cache.delete(id);
      }
    },
  };
}
export function imageObjectCacheStats() {
  return cache.stats();
}
