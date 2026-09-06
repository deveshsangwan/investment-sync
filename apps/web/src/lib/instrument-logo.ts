export type InstrumentLogoInput = {
  symbol?: string | null;
  isin?: string | null;
  exchange?: string | null;
  assetClass?: string;
};

export function instrumentLogoUrls(
  instrument: InstrumentLogoInput,
  publishableKey: string | undefined,
) {
  if (!publishableKey?.startsWith("pk_")) return [];
  if (!["indian_stock", "us_stock"].includes(instrument.assetClass ?? ""))
    return [];

  const identifiers: string[] = [];
  const isin = instrument.isin?.trim().toUpperCase();
  if (isin && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
    identifiers.push(`isin/${isin}`);
  }

  const ticker = qualifiedTicker(instrument);
  if (ticker) identifiers.push(`ticker/${encodeURIComponent(ticker)}`);

  const params = new URLSearchParams({
    token: publishableKey,
    size: "128",
    format: "png",
    fallback: "404",
  });
  return identifiers.map(
    (identifier) => `https://img.logo.dev/${identifier}?${params}`,
  );
}

function qualifiedTicker({
  symbol,
  exchange,
  assetClass,
}: InstrumentLogoInput) {
  const ticker = symbol?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9][A-Z0-9.&-]{0,29}$/.test(ticker)) return null;

  const market = exchange?.trim().toUpperCase();
  if (assetClass === "indian_stock") {
    if (/\.(NS|BO)$/.test(ticker)) return ticker;

    const suffix = ["NSE", "XNSE", "NSE_EQ"].includes(market ?? "")
      ? "NS"
      : ["BSE", "XBOM", "BSE_EQ"].includes(market ?? "")
        ? "BO"
        : null;
    // An Indian symbol without an exchange must never fall through to the
    // provider's default US market, where the same symbol can name another issuer.
    if (!suffix || ticker.includes(".")) return null;

    return `${ticker.replace(/-(EQ|BE|BZ)$/, "")}.${suffix}`;
  }

  if (assetClass !== "us_stock") return null;
  if (
    market &&
    ![
      "NASDAQ",
      "NYSE",
      "NYSEARCA",
      "AMEX",
      "XNAS",
      "XNYS",
      "ARCX",
      "OTC",
      "BATS",
    ].includes(market)
  )
    return null;
  if (/\.(NS|BO|L|TO|HK)$/.test(ticker)) return null;

  return ticker;
}

const failedUrls = new Map<string, number>();
const retryDelay = 5 * 60 * 1000;

export function canRequestLogo(url: string, now = Date.now()) {
  const failedAt = failedUrls.get(url);
  if (failedAt === undefined) return true;
  if (now - failedAt < retryDelay) return false;

  failedUrls.delete(url);
  return true;
}

export function recordLogoFailure(url: string, now = Date.now()) {
  failedUrls.delete(url);
  failedUrls.set(url, now);
  // Bound the session cache when users browse a large collection of positions.
  if (failedUrls.size > 256) {
    const oldest = failedUrls.keys().next().value;
    if (oldest) failedUrls.delete(oldest);
  }
}
