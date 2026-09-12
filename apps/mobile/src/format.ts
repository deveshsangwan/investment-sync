const assetLabels: Record<string, string> = {
  indian_stock: "Indian stocks",
  us_stock: "US stocks & ETFs",
  mutual_fund: "Mutual funds",
  nps: "NPS",
  ulip: "ULIP",
  crypto: "Crypto",
  cash: "Cash",
  other: "Other assets",
};

export function assetClassLabel(value: string) {
  return assetLabels[value] ?? value.replaceAll("_", " ");
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
