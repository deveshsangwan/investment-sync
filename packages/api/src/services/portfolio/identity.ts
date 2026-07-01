import type { AssetClass, Currency } from "@investment-sync/importers";

export type AccountIdentityInput = {
  provider: string;
  name: string;
};

export type InstrumentIdentityInput = {
  assetClass: AssetClass;
  currency: Currency;
  symbol?: string | null;
  name: string;
};

export type InstrumentIdentity = {
  assetClass: AssetClass;
  currency: Currency;
  symbol: string | null;
  name: string;
  key: string;
};

export function accountIdentityKey(value: AccountIdentityInput) {
  return `${normalizeText(value.provider)}|${normalizeText(value.name)}`;
}

export function instrumentIdentity(
  value: InstrumentIdentityInput,
): InstrumentIdentity {
  const symbol = value.symbol ? normalizeSymbol(value.symbol) || null : null;
  const name = normalizeText(value.name);
  const identity = symbol ? `symbol:${symbol}` : `name:${name}`;

  return {
    assetClass: value.assetClass,
    currency: value.currency,
    symbol,
    name,
    key: `${value.assetClass}|${value.currency}|${identity}`,
  };
}

export function instrumentIdentityKey(value: InstrumentIdentityInput) {
  return instrumentIdentity(value).key;
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}
