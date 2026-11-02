import type { Database } from "../db/connection";
import { BoundedCache } from "./bounded-cache";
import type { CommunityFeed, CommunityPost } from "../domain/community";
export type DiscoveryValue = CommunityFeed | CommunityPost[];
const runtime = globalThis as unknown as {
  sliperDiscoveryCaches?: WeakMap<object, BoundedCache<DiscoveryValue>>;
};
const caches = (runtime.sliperDiscoveryCaches ??= new WeakMap());
export function discoveryCache(db: Database) {
  let cache = caches.get(db);
  if (!cache) {
    cache = new BoundedCache<DiscoveryValue>({
      maxEntries: 128,
      maxBytes: 16 * 1024 * 1024,
      size: (value) => Buffer.byteLength(JSON.stringify(value)),
    });
    caches.set(db, cache);
  }
  return cache;
}
export function invalidateDiscoveryCache(db: Database) {
  caches.get(db)?.clear();
}
