import { currencyRates, type Database } from "@investment-sync/db";
import { and, eq, sql } from "drizzle-orm";
import { Clock, Data, Effect, Schedule, Schema, SynchronizedRef } from "effect";
import { logger } from "../logger";

const USD_INR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const USD_INR_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const FRANKFURTER_USD_INR_URL = "https://api.frankfurter.dev/v2/rate/USD/INR";
const RATE_FETCH_TIMEOUT_MS = 4_000;
const ratePayloadSchema = Schema.Struct({
  rate: Schema.Number.pipe(Schema.finite(), Schema.positive()),
});

class CurrencyRateProviderError extends Data.TaggedError(
  "CurrencyRateProviderError",
)<{
  message: string;
  retryable: boolean;
  cause?: unknown;
}> {}

export class CurrencyRateUnavailableError extends Data.TaggedError(
  "CurrencyRateUnavailableError",
)<{ message: string }> {}

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

// ponytail: one rate pair and one production DB; use keyed locks if more pairs are added.
const cachedRates = Effect.runSync(
  SynchronizedRef.make(new Map<Database | undefined, CachedRate>()),
);

export function getUsdInrRate(db?: Database): Promise<CurrencyRateQuote> {
  return Effect.runPromise(
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        SynchronizedRef.modifyEffect(cachedRates, (rates) => {
          const cached = rates.get(db);
          if (cached && cached.expiresAt > now) {
            return Effect.succeed([toQuote(cached, false), rates] as const);
          }
          return loadUsdInrRate(db, cached, now).pipe(
            Effect.map(({ rate, isStale }) => {
              const next = new Map(rates);
              next.set(db, rate);
              return [toQuote(rate, isStale), next] as const;
            }),
          );
        }),
      ),
    ),
  );
}

function loadUsdInrRate(
  db: Database | undefined,
  cached: CachedRate | undefined,
  now: number,
): Effect.Effect<
  { rate: CachedRate; isStale: boolean },
  CurrencyRateUnavailableError
> {
  return Effect.promise(() => tryReadPersistedUsdInrRate(db)).pipe(
    Effect.flatMap((persisted) => {
      if (persisted && persisted.expiresAt > now) {
        return Effect.succeed({ rate: persisted, isStale: false });
      }

      return fetchUsdInrRateOnce().pipe(
        Effect.retry({
          times: 1,
          while: (error) => error.retryable,
          schedule: Schedule.exponential("100 millis").pipe(Schedule.jittered),
        }),
        Effect.flatMap((rate) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((fetchedAt) => ({
              rate,
              fetchedAt: new Date(fetchedAt).toISOString(),
              expiresAt: fetchedAt + USD_INR_CACHE_TTL_MS,
            })),
          ),
        ),
        Effect.tap((rate) => persistUsdInrRateEffect(db, rate)),
        Effect.map((rate) => ({ rate, isStale: false })),
        Effect.catchAll((error) => {
          logger.warn("USD/INR rate fetch failed", { error: error.message });
          const stale = newestUsableStale(cached, persisted, now);
          return stale
            ? Effect.succeed({ rate: stale, isStale: true })
            : Effect.fail(
                new CurrencyRateUnavailableError({
                  message: "USD/INR exchange rate is unavailable",
                }),
              );
        }),
      );
    }),
  );
}

function fetchUsdInrRateOnce() {
  return Effect.tryPromise({
    try: (signal) =>
      fetch(FRANKFURTER_USD_INR_URL, {
        headers: { accept: "application/json" },
        signal,
      }),
    catch: (cause) =>
      new CurrencyRateProviderError({
        message: "Frankfurter request failed",
        retryable: true,
        cause,
      }),
  }).pipe(
    Effect.timeoutFail({
      duration: RATE_FETCH_TIMEOUT_MS,
      onTimeout: () =>
        new CurrencyRateProviderError({
          message: "Frankfurter request timed out",
          retryable: true,
        }),
    }),
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail(
          new CurrencyRateProviderError({
            message: `Frankfurter returned ${response.status}`,
            retryable: response.status === 429 || response.status >= 500,
          }),
        );
      }
      return Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new CurrencyRateProviderError({
            message: "Frankfurter returned invalid JSON",
            retryable: false,
            cause,
          }),
      });
    }),
    Effect.flatMap((payload) =>
      Schema.decodeUnknown(ratePayloadSchema)(payload).pipe(
        Effect.mapError(
          (cause) =>
            new CurrencyRateProviderError({
              message: "Frankfurter returned an invalid USD/INR rate",
              retryable: false,
              cause,
            }),
        ),
      ),
    ),
    Effect.map(({ rate }) => rate),
  );
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
        updatedAt: new Date(rate.fetchedAt),
      },
    });
}

function persistUsdInrRateEffect(db: Database | undefined, rate: CachedRate) {
  return Effect.tryPromise({
    try: () => persistUsdInrRate(db, rate),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn("USD/INR rate persistence failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );
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
    expiresAt: row.fetchedAt.getTime() + USD_INR_CACHE_TTL_MS,
  };
}

async function tryReadPersistedUsdInrRate(db: Database | undefined) {
  try {
    return await readPersistedUsdInrRate(db);
  } catch (error) {
    logger.warn("USD/INR rate persistence read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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

function isUsableStale(rate: CachedRate, now: number) {
  return new Date(rate.fetchedAt).getTime() >= now - USD_INR_MAX_STALE_MS;
}

function newestUsableStale(
  cached: CachedRate | undefined,
  persisted: CachedRate | undefined,
  now: number,
) {
  return [cached, persisted]
    .filter((rate): rate is CachedRate => Boolean(rate))
    .filter((rate) => isUsableStale(rate, now))
    .sort((left, right) => right.expiresAt - left.expiresAt)[0];
}
