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
    : `${value}%`;
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

export function trendWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1);
  return Math.max(6, Math.round((value / max) * 100));
}
