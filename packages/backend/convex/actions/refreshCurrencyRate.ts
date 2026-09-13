"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { currencyRatePolicy } from "../model/currencyRates";

const providerUrl = "https://api.frankfurter.dev/v2/rate/USD/INR";

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
        message: error instanceof Error ? error.message : "Unknown failure",
        attempts,
      });

      return {
        outcome: settlement === "superseded" ? "superseded" : "failed",
        attempts,
      };
    }
  },
});

async function fetchWithRetry(load: () => Promise<number>) {
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
