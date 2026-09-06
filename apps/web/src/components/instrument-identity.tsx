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

export function InstrumentMark({
  name,
  symbol,
  assetClass,
}: {
  name: string;
  symbol?: string | null;
  assetClass?: string;
}) {
  const normalized = name.toLowerCase();
  const isMicrosoft = symbol === "MSFT" && normalized.includes("microsoft");
  const isHdfc = symbol === "HDFCBANK" && normalized.includes("hdfc");
  const isIcici = symbol === "ICICIBANK" && normalized.includes("icici");
  const hasIllustrativeMark = isMicrosoft || isHdfc || isIcici;

  return (
    <span
      className="mono-mark"
      title={hasIllustrativeMark ? "Illustrative company mark" : name}
      aria-hidden="true"
    >
      {isMicrosoft ? (
        <svg viewBox="0 0 24 24">
          <path fill="#f35325" d="M1 1h10v10H1z" />
          <path fill="#81bc06" d="M13 1h10v10H13z" />
          <path fill="#05a6f0" d="M1 13h10v10H1z" />
          <path fill="#ffba08" d="M13 13h10v10H13z" />
        </svg>
      ) : isHdfc ? (
        <svg viewBox="0 0 24 24">
          <path fill="#e83241" d="M1 1h22v22H1z" />
          <path fill="white" d="M5 5h14v14H5z" />
          <path fill="#26519c" d="M8 8h8v8H8z" />
          <path
            stroke="white"
            strokeWidth="2"
            d="M12 0v5m0 14v5M0 12h5m14 0h5"
          />
        </svg>
      ) : isIcici ? (
        <span className="text-[20px] italic text-[#e79a58]">i</span>
      ) : assetClass === "mutual_fund" || assetClass === "nps" ? (
        <AssetIcon assetClass={assetClass} />
      ) : (
        <span>
          {(symbol ?? name)
            .replace(/[^a-zA-Z]/g, "")
            .slice(0, 2)
            .toUpperCase()}
        </span>
      )}
    </span>
  );
}

export function InstrumentIdentity({
  name,
  symbol,
  assetClass,
  secondary,
}: {
  name: string;
  symbol?: string | null;
  assetClass?: string;
  secondary?: string;
}) {
  return (
    <span className="mono-identity">
      <InstrumentMark name={name} symbol={symbol} assetClass={assetClass} />
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
