export type InstrumentIdentity = {
  monogram: string;
  background: string;
  foreground: string;
  isBranded: boolean;
  mark?: "microsoft" | "hdfc" | "icici";
};

export function usesPictogram(assetClass: string) {
  return ["nps", "cash", "ulip", "other", "mutual_fund"].includes(assetClass);
}

export function resolveInstrumentIdentity({
  symbol,
  name,
  assetClass,
}: {
  symbol?: string | null;
  name: string;
  assetClass: string;
}): InstrumentIdentity {
  const normalized = normalizeSymbol(symbol);
  const mark =
    assetClass === "us_stock" &&
    normalized === "MSFT" &&
    /microsoft/i.test(name)
      ? "microsoft"
      : assetClass === "indian_stock" &&
          normalized === "HDFCBANK" &&
          /hdfc/i.test(name)
        ? "hdfc"
        : assetClass === "indian_stock" &&
            normalized === "ICICIBANK" &&
            /icici/i.test(name)
          ? "icici"
          : undefined;

  // These local illustrations aid recognition without a logo service. Require
  // both the investment category and issuer name before assigning a mark.
  return {
    monogram: initialsFrom(symbol, name),
    background: mark ? "#FAFAFA" : "hsl(var(--secondary))",
    foreground: "hsl(var(--muted-foreground))",
    isBranded: Boolean(mark),
    mark,
  };
}

/** `INFY.NS`, `INFY-EQ`, and `infy` all resolve to the same registry entry. */
export function normalizeSymbol(symbol: string | null | undefined) {
  if (!symbol) return undefined;
  const cleaned = symbol
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|NSE|BSE)$/, "")
    .replace(/-(EQ|BE|BZ)$/, "");
  return cleaned || undefined;
}

export function initialsFrom(
  symbol: string | null | undefined,
  name: string,
): string {
  const normalized = normalizeSymbol(symbol);
  if (normalized) return normalized.slice(0, 2);

  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .slice(0, 2)
    .map((word) => word.slice(0, words.length === 1 ? 2 : 1))
    .join("")
    .toUpperCase();
}
