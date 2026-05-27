// Shared in-process TTL cache for Orthogonal tool results.
// Node.js single-threaded event loop makes this safe for concurrent requests.
// search_orthogonal and get_api_details are read-only and deterministic —
// caching them avoids redundant network round-trips across requests and users.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

// Per-key in-flight promise — prevents duplicate concurrent fetches for the
// same cache key (thundering herd on a cold cache).
const inFlight = new Map<string, Promise<unknown>>();

class ToolCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, hits: 0 });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    entry.hits++;
    return entry.value as T;
  }

  // Deduplicated fetch: if a request for `key` is already in flight, wait for
  // it instead of firing another. Populates the cache on success.
  async getOrFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn().then((value) => {
      this.set(key, value, ttlMs);
      inFlight.delete(key);
      return value;
    }).catch((err) => {
      inFlight.delete(key);
      throw err;
    });

    inFlight.set(key, promise);
    return promise;
  }

  size(): number { return this.store.size; }

  purge(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

export const toolCache = new ToolCache();

// Purge expired entries every 5 minutes without keeping the process alive.
setInterval(() => toolCache.purge(), 5 * 60 * 1000).unref();
