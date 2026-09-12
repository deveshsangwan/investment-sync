import { InstrumentMark } from "@/components/instrument-mark";
import type { InstrumentLogoInput } from "@/lib/instrument-logo";
import {
  BarChart3,
  Bitcoin,
  BriefcaseBusiness,
  CircleDollarSign,
  Layers3,
  ShieldCheck,
  Sprout,
  WalletCards,
} from "lucide-react";
import { labelize } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AssetIcon({
  assetClass,
  className,
}: {
  assetClass: string;
  className?: string;
}) {
  const Icon =
    assetClass === "mutual_fund"
      ? Sprout
      : assetClass === "nps"
        ? ShieldCheck
        : assetClass === "crypto"
          ? Bitcoin
          : assetClass === "cash"
            ? WalletCards
            : assetClass === "ulip"
              ? Layers3
              : assetClass === "us_stock"
                ? CircleDollarSign
                : assetClass === "indian_stock"
                  ? BarChart3
                  : BriefcaseBusiness;

  return <Icon className={cn("size-5", className)} aria-hidden="true" />;
}

export function InstrumentIdentity({
  name,
  symbol,
  assetClass,
  secondary,
  isin,
  exchange,
  illustrative,
}: InstrumentLogoInput & {
  name: string;
  symbol?: string | null;
  assetClass?: string;
  secondary?: string;
  illustrative?: boolean;
}) {
  return (
    <span className="mono-identity">
      <InstrumentMark
        name={name}
        symbol={symbol}
        assetClass={assetClass ?? "other"}
        isin={isin}
        exchange={exchange}
        illustrative={illustrative}
        variant="mono"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {symbol ?? name}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {secondary ??
            (symbol ? name : assetClass ? labelize(assetClass) : "Investment")}
        </span>
      </span>
    </span>
  );
}
