const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function prune(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  prune();
}

export function buildSearchCacheKey(
  search: string | undefined,
  store: string | undefined,
  category?: string,
  barcode?: string,
  labels?: string,
  country = 'nl'
): string {
  if (barcode) {
    return `products:${country}:barcode:${barcode}:${(labels ?? '').toLowerCase()}`;
  }
  return `products:${country}:${(store ?? 'all').toLowerCase()}:${(category ?? 'all').toLowerCase()}:${(labels ?? 'all').toLowerCase()}:${(search ?? '').toLowerCase().trim()}`;
}
