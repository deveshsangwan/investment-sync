"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { currencyRatePolicy } from "../model/currencyRates";
import { hasMigrationWriteFreeze } from "../model/migrationFreeze";

const providerUrl = "https://api.frankfurter.dev/v2/providers/ecb/rate/USD/INR";

class CurrencyRateProviderError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
  }
}

type RefreshResult = {
  outcome: "saved" | "failed" | "superseded";
  attempts: number;
};
type Settlement = "saved" | "retained" | "superseded";

export const refreshCurrencyRate = internalAction({
  args: {},
  returns: v.object({
    outcome: v.union(
      v.literal("saved"),
      v.literal("failed"),
      v.literal("superseded"),
    ),
    attempts: v.number(),
  }),
  handler: async (ctx): Promise<RefreshResult> => {
    if (hasMigrationWriteFreeze())
      return { outcome: "superseded", attempts: 0 };
    const beginning: { requestRevision: number } = await ctx.runMutation(
      internal.currencyRates.beginRefresh,
      {},
    );
    const { requestRevision } = beginning;
    let attempts = 0;

    try {
      const rate = await fetchWithRetry(() => {
        attempts += 1;
        return fetchRateOnce();
      });
      const settlement: Settlement = await ctx.runMutation(
        internal.currencyRates.saveQuote,
        {
          requestRevision,
          rate: String(rate),
          fetchedAt: new Date().toISOString(),
        },
      );

      return {
        outcome: settlement === "saved" ? "saved" : "superseded",
        attempts,
      };
    } catch (error) {
      const settlement: Settlement = await ctx.runMutation(
        internal.currencyRates.retainQuoteAfterFailure,
        { requestRevision },
      );
      console.warn("currency-rate refresh failed", {
        error,
        requestRevision,
        pair: "USD/INR",
        attempts,
      });

      return {
        outcome: settlement === "superseded" ? "superseded" : "failed",
        attempts,
      };
    }
  },
});

async function fetchWithRetry<T>(load: () => Promise<T>) {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof CurrencyRateProviderError) || !error.isRetryable)
      throw error;

    await delay(currencyRatePolicy.retryDelayMilliseconds);
    return load();
  }
}

async function fetchRateOnce() {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    currencyRatePolicy.requestTimeoutMilliseconds,
  );
  try {
    let response: Response;
    try {
      response = await fetch(providerUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      throw new CurrencyRateProviderError(
        "Frankfurter request failed or timed out",
        true,
      );
    }

    if (!response.ok) {
      throw new CurrencyRateProviderError(
        `Frankfurter returned ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new CurrencyRateProviderError(
        controller.signal.aborted
          ? "Frankfurter request timed out"
          : "Frankfurter returned invalid JSON",
        controller.signal.aborted || error instanceof TypeError,
      );
    }
    if (!isRatePayload(payload)) {
      throw new CurrencyRateProviderError(
        "Frankfurter returned an invalid USD/INR rate",
        false,
      );
    }

    return payload.rate;
  } finally {
    clearTimeout(timeout);
  }
}

function isRatePayload(value: unknown): value is { rate: number } {
  if (typeof value !== "object" || value === null || !("rate" in value))
    return false;

  const rate = value.rate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

type HistoricalRequests = {
  dates: string[];
  continuationCursor: string | null;
  hasMoreDates: boolean;
};

export const refreshHistoricalCurrencyRates = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ saved: v.number(), failed: v.number() }),
  handler: async (ctx, args): Promise<{ saved: number; failed: number }> => {
    if (hasMigrationWriteFreeze()) return { saved: 0, failed: 0 };

    const cursor = args.cursor ?? null;
    const requests: HistoricalRequests = await ctx.runQuery(
      internal.currencyRates.historicalRequests,
      {
        cursor,
        beforeDate: new Date().toISOString().slice(0, 10),
      },
    );
    const quotes: { date: string; rateDate: string; rate: string }[] = [];
    let failed = 0;

    for (let index = 0; index < requests.dates.length; index += 4) {
      const results = await Promise.allSettled(
        requests.dates
          .slice(index, index + 4)
          .map((date) => fetchWithRetry(() => fetchHistoricalRate(date))),
      );
      for (const result of results) {
        if (result.status === "fulfilled") quotes.push(result.value);
        else failed += 1;
      }
    }

    const saved: number = await ctx.runMutation(
      internal.currencyRates.saveHistoricalQuotes,
      { quotes },
    );

    // Retry failed dates on the next cron, rather than looping on an outage.
    const nextCursor =
      requests.hasMoreDates && failed === 0
        ? cursor
        : requests.continuationCursor;
    if ((requests.hasMoreDates && failed === 0) || nextCursor !== null)
      await ctx.scheduler.runAfter(
        0,
        internal.actions.refreshCurrencyRate.refreshHistoricalCurrencyRates,
        { cursor: nextCursor },
      );

    return { saved, failed };
  },
});

async function fetchHistoricalRate(date: string) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    currencyRatePolicy.requestTimeoutMilliseconds,
  );

  try {
    let response: Response;
    try {
      response = await fetch(
        `https://api.frankfurter.dev/v2/providers/ecb/rate/USD/INR?date=${encodeURIComponent(date)}`,
        {
          headers: { accept: "application/json" },
          signal: controller.signal,
        },
      );
    } catch {
      throw new CurrencyRateProviderError(
        "Historical rate request failed or timed out",
        true,
      );
    }

    if (!response.ok)
      throw new CurrencyRateProviderError(
        `Historical rate provider returned ${response.status}`,
        response.status === 429 || response.status >= 500,
      );

    const payload: unknown = await response.json();
    if (
      !isRatePayload(payload) ||
      !("date" in payload) ||
      typeof payload.date !== "string" ||
      !("base" in payload) ||
      payload.base !== "USD" ||
      !("quote" in payload) ||
      payload.quote !== "INR" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
      !Number.isFinite(Date.parse(payload.date)) ||
      new Date(payload.date).toISOString().slice(0, 10) !== payload.date ||
      payload.date > date ||
      Date.parse(date) - Date.parse(payload.date) > 7 * 86400000
    )
      throw new CurrencyRateProviderError(
        "Invalid historical USD/INR response",
        false,
      );

    return { date, rateDate: payload.date, rate: String(payload.rate) };
  } finally {
    clearTimeout(timeout);
  }
}
