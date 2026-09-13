"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useConvex, useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { convexToJson } from "convex/values";
import {
  getQueryCacheRetentionMs,
  QuerySubscriptionCache,
} from "../lib/query-subscription-cache";

const CacheContext = createContext<QuerySubscriptionCache | null>(null);
const emptyArgs = {};
const retentionMs = getQueryCacheRetentionMs(
  process.env.NEXT_PUBLIC_QUERY_CACHE_RETENTION_SECONDS,
);

export function QueryCacheProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const cache = useMemo(() => new QuerySubscriptionCache(retentionMs, 20), []);

  // The parent is keyed by Clerk identity/session. Also release retained queries
  // if authentication is lost without changing that identity.
  useEffect(() => {
    if (!enabled) cache.clear();
    return () => cache.clear();
  }, [cache, enabled]);

  return (
    <CacheContext.Provider value={cache}>{children}</CacheContext.Provider>
  );
}

export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
) {
  const cache = useContext(CacheContext);
  const client = useConvex();
  const queryArgs = args[0] ?? emptyArgs;

  if (!cache) throw new Error("Query cache provider is missing");

  useEffect(() => {
    if (queryArgs === "skip") return;

    const key = JSON.stringify([
      getFunctionName(query),
      convexToJson(queryArgs),
    ]);
    return cache.retain(key, (onError) => {
      const watch = client.watchQuery(query, queryArgs);
      return watch.onUpdate(() => {
        try {
          watch.localQueryResult();
        } catch {
          // Failed queries must not survive the error boundary's retry remount.
          onError();
        }
      });
    });
  }, [cache, client, query, queryArgs]);

  return useQuery(query, ...args);
}
