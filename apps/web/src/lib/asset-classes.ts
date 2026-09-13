import {
  assetClassSchema,
  type AssetClass,
} from "@investment-sync/importers/types";

export const assetClassValues = assetClassSchema.options;
export type { AssetClass };

export function parseAssetClass(value: string): AssetClass | undefined {
  return assetClassSchema.safeParse(value).data;
}
