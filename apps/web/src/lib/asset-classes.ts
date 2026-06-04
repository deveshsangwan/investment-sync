export const assetClassValues = [
  "indian_stock",
  "mutual_fund",
  "us_stock",
  "nps",
  "ulip",
  "crypto",
  "cash",
  "other",
] as const;

export type AssetClass = (typeof assetClassValues)[number];

export function parseAssetClass(value: string): AssetClass {
  return assetClassValues.includes(value as AssetClass) ? (value as AssetClass) : "other";
}
