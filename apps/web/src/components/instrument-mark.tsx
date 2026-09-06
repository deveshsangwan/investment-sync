"use client";

import { useState, type ReactNode } from "react";
import {
  instrumentLogoUrls,
  canRequestLogo,
  recordLogoFailure,
  type InstrumentLogoInput,
} from "@/lib/instrument-logo";
import { assetClassMeta } from "@/lib/asset-class-meta";
import {
  resolveInstrumentIdentity,
  usesPictogram,
} from "@/lib/instrument-identity";
import { cn } from "@/lib/utils";

/**
 * Fixed-size instrument identity. The box is reserved before the mark resolves
 * so a row never shifts, and the mark itself is decorative: the ticker and
 * instrument name beside it carry the accessible text.
 */
export function InstrumentMark({
  symbol,
  name,
  assetClass,
  size = "row",
  className,
  isin,
  exchange,
  illustrative = false,
  variant,
}: InstrumentLogoInput & {
  symbol?: string | null;
  name: string;
  assetClass: string;
  size?: "row" | "detail";
  className?: string;
  illustrative?: boolean;
  variant?: "mono";
}) {
  const identity = resolveInstrumentIdentity({
    symbol,
    name,
    assetClass,
    illustrative,
  });
  const urls = illustrative
    ? []
    : instrumentLogoUrls(
        { name, symbol, isin, exchange, assetClass },
        process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY,
      );
  const boxClass =
    variant === "mono"
      ? "mono-mark"
      : size === "detail"
        ? "size-11 rounded-xl text-sm"
        : "size-8 rounded-lg text-[0.7rem] md:size-7";

  if (!identity.isBranded && usesPictogram(assetClass)) {
    const Icon = assetClassMeta(assetClass).icon;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center border border-border/70 bg-secondary text-muted-foreground",
          boxClass,
          className,
        )}
      >
        <LogoImage key={urls.join("|")} urls={urls}>
          <Icon className={size === "detail" ? "size-5" : "size-3.5"} />
        </LogoImage>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      title={identity.mark ? "Illustrative company mark" : undefined}
      // The hairline keeps near-black and near-white brand colours legible
      // against the canvas of either theme.
      className={cn(
        "grid shrink-0 place-items-center border border-border/70 font-semibold leading-none tracking-[-0.01em]",
        boxClass,
        className,
      )}
      style={{
        backgroundColor: identity.background,
        color: identity.foreground,
      }}
    >
      <LogoImage key={urls.join("|")} urls={urls}>
        {identity.mark ? (
          <CompanyIllustration mark={identity.mark} />
        ) : (
          identity.monogram
        )}
      </LogoImage>
    </span>
  );
}

function CompanyIllustration({
  mark,
}: {
  mark: "microsoft" | "hdfc" | "icici";
}) {
  return (
    <svg viewBox="0 0 24 24" className="size-[72%]" aria-hidden="true">
      {mark === "microsoft" ? (
        <>
          <path fill="#F25022" d="M1 1h10v10H1z" />
          <path fill="#7FBA00" d="M13 1h10v10H13z" />
          <path fill="#00A4EF" d="M1 13h10v10H1z" />
          <path fill="#FFB900" d="M13 13h10v10H13z" />
        </>
      ) : mark === "hdfc" ? (
        <>
          <path fill="#E52C3B" d="M1 1h22v22H1z" />
          <path fill="#FFFFFF" d="M5 5h14v14H5z" />
          <path fill="#17458F" d="M8 8h8v8H8z" />
          <path
            stroke="#FFFFFF"
            strokeWidth="2"
            d="M12 0v5m0 14v5M0 12h5m14 0h5"
          />
        </>
      ) : (
        <>
          <ellipse
            fill="#B54421"
            cx="12"
            cy="12"
            rx="10"
            ry="11"
            transform="rotate(28 12 12)"
          />
          <circle fill="#F7AA36" cx="15" cy="5" r="2.4" />
          <path fill="#F7AA36" d="m11 9 5-1-4 10H7z" />
        </>
      )}
    </svg>
  );
}

function LogoImage({
  urls,
  children,
}: {
  urls: string[];
  children: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const url = urls.find(
    (candidate) => !failed.includes(candidate) && canRequestLogo(candidate),
  );

  return (
    <span className="relative grid size-full place-items-center overflow-hidden rounded-[inherit]">
      {children}
      {url ? (
        <img
          src={url}
          alt=""
          width={128}
          height={128}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full bg-white object-contain p-1"
          style={{ opacity: loadedUrl === url ? 1 : 0 }}
          onLoad={() => setLoadedUrl(url)}
          onError={() => {
            recordLogoFailure(url);
            setFailed((previous) => [...previous, url]);
          }}
        />
      ) : null}
    </span>
  );
}
