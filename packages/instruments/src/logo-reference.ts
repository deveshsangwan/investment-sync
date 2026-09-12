import nse from "./logo-data/nse.json";

const nseIdentifiers: Readonly<Record<string, string>> = nse.identifiers;

export function findNseSecurity(symbol: string | null | undefined) {
  const normalized = symbol
    ?.trim()
    .toUpperCase()
    .replace(/-(EQ|BE|BZ)$/, "");
  if (!normalized || !Object.hasOwn(nseIdentifiers, normalized)) return null;

  return { symbol: normalized, isin: nseIdentifiers[normalized] };
}

// These are issuer identities, not per-fund image files. Sources and refresh
// instructions live in docs/instrument-logos.md.
const fundIssuers = [
  { prefixes: ["axis"], domain: "axismf.com" },
  { prefixes: ["hdfc"], domain: "hdfcfund.com" },
  { prefixes: ["icici pru", "icici prudential"], domain: "icicipruamc.com" },
  { prefixes: ["motilal oswal"], domain: "motilaloswalmf.com" },
  { prefixes: ["nippon india"], domain: "nipponindiaim.com" },
  { prefixes: ["parag parikh", "ppfas"], domain: "ppfas.com" },
  { prefixes: ["quant"], domain: "quantmutual.com" },
  { prefixes: ["sbi"], domain: "sbimf.com" },
  { prefixes: ["tata"], domain: "tatamutualfund.com" },
];

export function namedLogoIdentifier(
  name: string | undefined,
  assetClass: string | undefined,
) {
  const normalized = name?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized || /\b(summary|total)\b/.test(normalized)) return null;

  if (assetClass === "mutual_fund") {
    const issuer = fundIssuers.find(({ prefixes }) =>
      prefixes.some((prefix) => normalized.startsWith(`${prefix} `)),
    );
    return issuer?.domain ?? null;
  }

  if (assetClass === "ulip") {
    if (/^hdfc (life |click\s*2\s*invest\b|sanchay\b)/.test(normalized))
      return "hdfclife.com";
    if (
      /^bajaj (allianz life |life |allianz goal assure\b|alliance goal assure\b)/.test(
        normalized,
      )
    )
      return "bajajlifeinsurance.com";
    return null;
  }

  if (assetClass === "crypto") {
    const coins: Readonly<Record<string, string>> = {
      bitcoin: "crypto/BTC",
      solana: "crypto/SOL",
      "rei network": "rei.network",
    };
    return Object.hasOwn(coins, normalized) ? coins[normalized] : null;
  }

  return null;
}
