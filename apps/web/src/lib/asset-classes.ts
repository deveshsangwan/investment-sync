import { assetClassEnum } from "@investment-sync/db";

export const assetClassValues = assetClassEnum.enumValues;

export type AssetClass = (typeof assetClassValues)[number];

export function parseAssetClass(value: string): AssetClass | undefined {
  return assetClassValues.includes(value as AssetClass)
    ? (value as AssetClass)
    : undefined;
}
