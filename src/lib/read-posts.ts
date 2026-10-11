// Read history belongs to this browser and contains only published post IDs.
export const READ_POSTS_STORAGE_KEY = "sliper:read-posts:v1";
export const MAX_READ_POSTS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_IDS: readonly string[] = Object.freeze([]);
interface ReadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface StoreEnvironment {
  getStorage: () => ReadStorage | null;
  onStorage?: (listener: (value: string | null) => void) => () => void;
}
export function normalizeReadPostId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
function parseHistory(raw: string | null): readonly string[] | null {
  if (raw === null) return EMPTY_IDS;
  if (raw.length > MAX_READ_POSTS * 80) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("ids" in parsed) ||
      !Array.isArray(parsed.ids)
    )
      return null;
    return uniqueIds(parsed.ids);
  } catch {
    return null;
  }
}
function uniqueIds(values: readonly unknown[]): readonly string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const id = normalizeReadPostId(value);
    if (id) ids.add(id);
    if (ids.size === MAX_READ_POSTS) break;
  }
  return ids.size ? Object.freeze([...ids]) : EMPTY_IDS;
}
interface StoredHistory {
  raw: string | null;
  ids: readonly string[];
}
function storedHistory(raw: string | null): StoredHistory | null {
  const stored = parseHistory(raw);
  return stored === null ? null : { raw, ids: stored };
}
export function createReadPostsStore(environment: StoreEnvironment) {
  let ids = EMPTY_IDS;
  let initialized = false;
  let lastStoredRaw: string | null | undefined;
  let stopStorage: (() => void) | undefined;
  const listeners = new Set<() => void>();
  function readStorage(): StoredHistory | null {
    try {
      const storage = environment.getStorage();
      return storage ? storedHistory(storage.getItem(READ_POSTS_STORAGE_KEY)) : null;
    } catch {
      return null;
    }
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    const stored = readStorage();
    if (stored) {
      ids = stored.ids;
      lastStoredRaw = stored.raw;
    }
  }
  function replace(next: readonly string[]) {
    if (ids.length === next.length && ids.every((id, index) => id === next[index])) return;
    ids = next;
    for (const listener of listeners) listener();
  }
  function observeStorage(stored: StoredHistory | null, removed = false) {
    if (!stored) return;
    // Missing/empty storage after a successful write means an intentional reset.
    // An unchanged empty area can instead contain unsaved reads after failed writes.
    const reset =
      removed ||
      (lastStoredRaw !== undefined && lastStoredRaw !== stored.raw && !stored.ids.length);
    lastStoredRaw = stored.raw;
    replace(reset ? stored.ids : uniqueIds([...stored.ids, ...ids]));
  }
  return {
    getSnapshot() {
      initialize();
      return ids;
    },
    getServerSnapshot() {
      return EMPTY_IDS;
    },
    subscribe(listener: () => void) {
      initialize();
      listeners.add(listener);
      // Other tabs can update or remove history while every reading widget is unmounted.
      if (listeners.size === 1) observeStorage(readStorage());
      if (listeners.size === 1 && environment.onStorage) {
        stopStorage = environment.onStorage((value) => {
          // A queued storage event can be older than the storage area's current value.
          const current = readStorage() ?? storedHistory(value);
          observeStorage(current, current?.raw === null);
        });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stopStorage?.();
          stopStorage = undefined;
        }
      };
    },
    mark(id: string) {
      const normalized = normalizeReadPostId(id);
      if (!normalized) return false;
      initialize();
      observeStorage(readStorage());
      const next = uniqueIds([normalized, ...ids]);
      replace(next);
      try {
        const storage = environment.getStorage();
        if (storage) {
          const raw = JSON.stringify({ version: 1, ids: next });
          storage.setItem(READ_POSTS_STORAGE_KEY, raw);
          lastStoredRaw = raw;
        }
      } catch {
        /* Browser privacy settings or full storage must not interrupt reading. */
      }
      return true;
    },
  };
}
export const readPostsStore = createReadPostsStore({
  getStorage: () => (typeof window === "undefined" ? null : window.localStorage),
  onStorage: (listener) => {
    if (typeof window === "undefined") return () => {};
    const receive = (event: StorageEvent) => {
      if (event.key !== null && event.key !== READ_POSTS_STORAGE_KEY) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      listener(event.newValue);
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  },
});
export function markPostRead(id: string) {
  return readPostsStore.mark(id);
}
