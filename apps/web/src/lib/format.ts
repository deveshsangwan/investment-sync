const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const usdCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percentage = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

const quantity = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 6,
});

export function formatInr(value: number) {
  return inrCurrency.format(value);
}

export function formatUsd(value: number) {
  return usdCurrency.format(value);
}

export function formatCurrency(value: number, currency?: string | null) {
  if (currency === "USD") return formatUsd(value);
  return formatInr(value);
}

export function formatPercent(value: number | undefined | null) {
  return value === undefined || value === null || !Number.isFinite(value)
    ? "N/A"
    : `${percentage.format(value)}%`;
}

export function formatQuantity(value: string | number | null | undefined) {
  const parsed = numberOrUndefined(value);
  return parsed === undefined ? "N/A" : quantity.format(parsed);
}

export function qualityLabel(value: string | undefined) {
  if (value === "exact") return "Exact cash-flow XIRR";
  if (value === "source_provided") return "Source provided";
  if (value === "estimated") return "Estimated from snapshots";
  return "Needs cash flows";
}

export function numberOrUndefined(value: string | number | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function labelize(value: string) {
  const assetLabels: Record<string, string> = {
    indian_stock: "Indian stocks",
    us_stock: "US stocks",
    mutual_fund: "Mutual funds",
    nps: "NPS",
    ulip: "ULIP",
    crypto: "Crypto",
    cash: "Cash",
    other: "Other assets",
  };

  if (assetLabels[value]) return assetLabels[value];

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatAsOfDate(value: string | Date) {
  return `As of ${formatDate(value)}`;
}

export function sourceLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    investment_portfolio_xlsx: "Portfolio workbook",
    nps_csv: "NPS statement",
    tickertape_stock_csv: "Tickertape stocks",
    tickertape_mutual_fund_csv: "Tickertape mutual funds",
    vested_drivewealth_xlsx: "Vested / DriveWealth",
    manual_snapshot: "Manual snapshot",
    cas_pdf: "CAS statement",
    unknown: "Detected file",
  };
  return value ? (labels[value] ?? labelize(value)) : "Detected file";
}

export function npsSchemeLabel(code: string) {
  const labels: Record<string, string> = {
    A: "Scheme A · Alternatives",
    C: "Scheme C · Corporate debt",
    E: "Scheme E · Equity",
    G: "Scheme G · Government securities",
  };
  return labels[code] ?? `Scheme ${code}`;
}

export function trendWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1);
  return Math.max(6, Math.round((value / max) * 100));
}

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Splits an exact amount so a headline can set the rupees large and keep the
 * paise readable but quiet. The fraction includes its separator.
 */
export function formatCurrencyParts(value: number, currency?: string | null) {
  const text = (currency === "USD" ? usdPrecise : inrPrecise).format(value);
  const separator = text.lastIndexOf(".");
  return separator === -1
    ? { lead: text, fraction: "" }
    : { lead: text.slice(0, separator), fraction: text.slice(separator) };
}

/** Signed money for outcomes: the sign is part of the reading, not decoration. */
export function formatSignedCurrency(value: number, currency?: string | null) {
  const magnitude = formatCurrency(Math.abs(value), currency);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}

export function formatSignedPercent(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "N/A";
  }
  const magnitude = `${percentage.format(Math.abs(value))}%`;
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}
