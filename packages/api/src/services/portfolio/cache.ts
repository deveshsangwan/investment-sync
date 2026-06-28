import type { ApiContext } from "../../context";
import { getHouseholdPortfolioCache } from "../portfolio-cache";
import type { PortfolioContext } from "./types";

export function cached<T>(
  ctx: ApiContext,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = ctx.cache.get(key);
  if (existing) return existing as Promise<T>;

  const promise = load();
  ctx.cache.set(key, promise);
  return promise;
}

export function cachedPortfolioData<T>(
  ctx: PortfolioContext,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  return cached(ctx, key, () =>
    getHouseholdPortfolioCache(ctx.membership.householdId, key, load),
  );
}
