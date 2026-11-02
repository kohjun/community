/** Bounded, process-local cache. Never use it as an authorization decision. */
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private generation = 0;
  private counts = { hits: 0, misses: 0, loads: 0, coalesced: 0, evictions: 0 };
  constructor(
    private options: {
      maxEntries: number;
      maxBytes: number;
      maxPending?: number;
      size: (value: T) => number;
      clock?: () => number;
    },
  ) {}
  private now() {
    return this.options.clock?.() ?? Date.now();
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
    // Detach an older fill; its completion must not repopulate the entry.
    this.pending.delete(key);
  }
  clear() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }
  stats() {
    return {
      ...this.counts,
      entries: this.entries.size,
      bytes: this.bytes,
      pending: this.pending.size,
    };
  }
  async read(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) {
      this.counts.hits++;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.value;
    }
    if (entry) this.delete(key);
    const pending = this.pending.get(key);
    if (pending) {
      this.counts.coalesced++;
      return pending;
    }
    this.counts.misses++;
    this.counts.loads++;
    if (ttlMs <= 0 || this.pending.size >= (this.options.maxPending ?? 64)) return load();
    const generation = this.generation;
    const work = Promise.resolve().then(load);
    this.pending.set(key, work);
    try {
      const value = await work;
      if (generation === this.generation && this.pending.get(key) === work) {
        const bytes = this.options.size(value);
        if (Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= this.options.maxBytes) {
          this.delete(key);
          this.entries.set(key, { value, bytes, expires: this.now() + ttlMs });
          this.bytes += bytes;
          while (
            this.entries.size > this.options.maxEntries ||
            this.bytes > this.options.maxBytes
          ) {
            this.delete(this.entries.keys().next().value!);
            this.counts.evictions++;
          }
        }
      }
      return value;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }
}
