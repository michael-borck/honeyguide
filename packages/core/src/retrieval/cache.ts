interface CacheEntry {
  value: unknown;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * Small process-local JSON cache for retrieval APIs. Repeated topics and
 * batch runs then cost nothing, and the upstream APIs see fewer requests.
 * Keyed by full URL, so headers and query strings are part of the identity.
 */
export function getCachedJson<T>(
  key: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (now - entry.at > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  // Refresh insertion order so the eviction below is least-recently-used.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

export function setCachedJson(key: string, value: unknown, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, at: now });
}

export function clearJsonCache(): void {
  cache.clear();
}
