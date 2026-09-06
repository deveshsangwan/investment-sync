import {
  Banknote,
  Bitcoin,
  CandlestickChart,
  Globe,
  Landmark,
  Layers,
  Shapes,
  Umbrella,
  type LucideIcon,
} from "lucide-react";
import type { AssetClass } from "@/lib/asset-classes";
import { labelize } from "@/lib/format";

type AssetClassMeta = {
  /** How a household names this group, not how the enum spells it. */
  label: string;
  /** Plural noun for the things inside the group. */
  unit: string;
  icon: LucideIcon;
};

const metaByAssetClass: Record<AssetClass, AssetClassMeta> = {
  indian_stock: {
    label: "Indian stocks",
    unit: "companies",
    icon: CandlestickChart,
  },
  mutual_fund: { label: "Mutual funds", unit: "funds", icon: Layers },
  us_stock: { label: "US stocks & ETFs", unit: "companies", icon: Globe },
  nps: { label: "NPS", unit: "accounts", icon: Landmark },
  ulip: { label: "ULIP", unit: "policies", icon: Umbrella },
  crypto: { label: "Crypto", unit: "assets", icon: Bitcoin },
  cash: { label: "Cash", unit: "balances", icon: Banknote },
  other: { label: "Other assets", unit: "holdings", icon: Shapes },
};

export function assetClassMeta(assetClass: string): AssetClassMeta {
  return (
    metaByAssetClass[assetClass as AssetClass] ?? {
      label: labelize(assetClass),
      unit: "holdings",
      icon: Shapes,
    }
  );
}

export function assetClassLabel(assetClass: string) {
  return assetClassMeta(assetClass).label;
}
