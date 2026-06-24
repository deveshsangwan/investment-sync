import { currencyRates, type Database } from "@investment-sync/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger";

const USD_INR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FRANKFURTER_USD_INR_URL = "https://api.frankfurter.dev/v2/rate/USD/INR";
const RATE_FETCH_TIMEOUT_MS = 4_000;

interface CachedRate {
  rate: number;
  fetchedAt: string;
  expiresAt: number;
}

export interface CurrencyRateQuote {
  base: "USD";
  quote: "INR";
  rate: number;
  fetchedAt: string;
  provider: "frankfurter";
  isStale: boolean;
}

let cachedUsdInrRate: CachedRate | undefined;
let pendingUsdInrRate: Promise<CurrencyRateQuote> | undefined;

export async function getUsdInrRate(db?: Database): Promise<CurrencyRateQuote> {
  const now = Date.now();
  if (cachedUsdInrRate && cachedUsdInrRate.expiresAt > now) {
    return toQuote(cachedUsdInrRate, false);
  }

  if (pendingUsdInrRate) return pendingUsdInrRate;

  pendingUsdInrRate = fetchUsdInrRate(now, db).finally(() => {
    pendingUsdInrRate = undefined;
  });

  return pendingUsdInrRate;
}

async function fetchUsdInrRate(
  now: number,
  db?: Database,
): Promise<CurrencyRateQuote> {
  try {
    const rate = await fetchUsdInrRateWithRetry();

    cachedUsdInrRate = {
      rate,
      fetchedAt: new Date().toISOString(),
      expiresAt: now + USD_INR_CACHE_TTL_MS,
    };
    try {
      await persistUsdInrRate(db, cachedUsdInrRate);
    } catch (persistError) {
      logger.warn("USD/INR rate persistence failed", {
        error:
          persistError instanceof Error
            ? persistError.message
            : String(persistError),
      });
    }

    return toQuote(cachedUsdInrRate, false);
  } catch (error) {
    logger.warn("USD/INR rate fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (cachedUsdInrRate) return toQuote(cachedUsdInrRate, true);
    const persisted = await readPersistedUsdInrRate(db);
    if (persisted) {
      cachedUsdInrRate = persisted;
      return toQuote(persisted, true);
    }
    throw new Error("USD/INR exchange rate is unavailable");
  }
}

async function fetchUsdInrRateWithRetry(): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchUsdInrRateOnce();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchUsdInrRateOnce(): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(FRANKFURTER_USD_INR_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Frankfurter returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      rate?: unknown;
      rates?: { INR?: unknown };
    };
    const rate = Number(payload.rate ?? payload.rates?.INR);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Frankfurter returned an invalid USD/INR rate");
    }
    return rate;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistUsdInrRate(db: Database | undefined, rate: CachedRate) {
  if (!db) return;
  await db
    .insert(currencyRates)
    .values({
      base: "USD",
      quote: "INR",
      rate: rate.rate.toString(),
      provider: "frankfurter",
      fetchedAt: new Date(rate.fetchedAt),
    })
    .onConflictDoUpdate({
      target: [currencyRates.base, currencyRates.quote, currencyRates.provider],
      set: {
        rate: sql`excluded.rate`,
        fetchedAt: sql`excluded.fetched_at`,
        updatedAt: new Date(),
      },
    });
}

async function readPersistedUsdInrRate(
  db: Database | undefined,
): Promise<CachedRate | undefined> {
  if (!db) return undefined;
  const [row] = await db
    .select({
      rate: currencyRates.rate,
      fetchedAt: currencyRates.fetchedAt,
    })
    .from(currencyRates)
    .where(
      and(
        eq(currencyRates.base, "USD"),
        eq(currencyRates.quote, "INR"),
        eq(currencyRates.provider, "frankfurter"),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return {
    rate,
    fetchedAt: row.fetchedAt.toISOString(),
    expiresAt: Date.now() - 1,
  };
}

function toQuote(rate: CachedRate, isStale: boolean): CurrencyRateQuote {
  return {
    base: "USD",
    quote: "INR",
    rate: rate.rate,
    fetchedAt: rate.fetchedAt,
    provider: "frankfurter",
    isStale,
  };
}
