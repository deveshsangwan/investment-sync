const PORTFOLIO_CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const householdPortfolioCache = new Map<string, CacheEntry<unknown>>();

export function getHouseholdPortfolioCache<T>(
  householdId: string,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cacheKey = `${householdId}:${key}`;
  const now = Date.now();
  const existing = householdPortfolioCache.get(cacheKey);

  if (existing && existing.expiresAt > now) {
    console.log("portfolio cache hit", key);
    return existing.promise as Promise<T>;
  }

  console.log("portfolio cache miss", key);

  let promise: Promise<T>;
  promise = load().catch((error) => {
    const latest = householdPortfolioCache.get(cacheKey);
    if (latest?.promise === promise) {
      householdPortfolioCache.delete(cacheKey);
    }
    throw error;
  });

  householdPortfolioCache.set(cacheKey, {
    expiresAt: now + PORTFOLIO_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export function clearHouseholdPortfolioCache(householdId: string) {
  const prefix = `${householdId}:`;
  for (const key of householdPortfolioCache.keys()) {
    if (key.startsWith(prefix)) {
      householdPortfolioCache.delete(key);
    }
  }
}
