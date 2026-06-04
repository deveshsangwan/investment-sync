const USD_INR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FRANKFURTER_USD_INR_URL = "https://api.frankfurter.dev/v2/rate/USD/INR";

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

export async function getUsdInrRate(): Promise<CurrencyRateQuote> {
  const now = Date.now();
  if (cachedUsdInrRate && cachedUsdInrRate.expiresAt > now) {
    return toQuote(cachedUsdInrRate, false);
  }

  if (pendingUsdInrRate) return pendingUsdInrRate;

  pendingUsdInrRate = fetchUsdInrRate(now).finally(() => {
    pendingUsdInrRate = undefined;
  });

  return pendingUsdInrRate;
}

async function fetchUsdInrRate(now: number): Promise<CurrencyRateQuote> {
  try {
    const response = await fetch(FRANKFURTER_USD_INR_URL, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Frankfurter returned ${response.status}`);
    }

    const payload = (await response.json()) as { rate?: unknown };
    const rate = Number(payload.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Frankfurter returned an invalid USD/INR rate");
    }

    cachedUsdInrRate = {
      rate,
      fetchedAt: new Date().toISOString(),
      expiresAt: now + USD_INR_CACHE_TTL_MS,
    };

    return toQuote(cachedUsdInrRate, false);
  } catch (error) {
    if (cachedUsdInrRate) return toQuote(cachedUsdInrRate, true);
    throw error;
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
