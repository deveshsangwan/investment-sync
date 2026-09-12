import { assetClassEnum, currencyEnum } from "@investment-sync/db";
import type { ApiContext } from "../../context";

export type PortfolioContext = ApiContext & {
  membership: { householdId: string };
};

export type AssetClass = (typeof assetClassEnum.enumValues)[number];
export type Currency = (typeof currencyEnum.enumValues)[number];

export type CurrentHoldingRow = {
  id: string;
  accountId: string;
  instrumentId: string;
  snapshotDate: string;
  quantity: string | null;
  investedAmount: string;
  currentValue: string;
  pnlAmount: string | null;
  pnlPercent: string | null;
  currency: Currency;
  sourcePayload: Record<string, unknown>;
  sourceSheet: string;
  accountName: string;
  provider: string;
  instrumentName: string;
  symbol: string | null;
  isin?: string | null;
  exchange?: string | null;
  assetClass: AssetClass;
};

export type SnapshotValuationRow = {
  accountId: string;
  instrumentId: string;
  snapshotDate: string;
  investedAmount: string;
  currentValue: string;
  currency: Currency;
  sourcePayload?: Record<string, unknown>;
  sourceSheet: string;
  accountName: string;
  provider: string;
  instrumentName: string;
  assetClass?: AssetClass;
};

export type PortfolioValuationRow = {
  valuationDate: string;
  investedAmount: string;
  currentValue: string;
  pnlAmount: string;
  currency: Currency;
};

export type CashFlowRow = {
  tradeDate: string;
  amount: string;
  type:
    | "buy"
    | "sell"
    | "dividend"
    | "fee"
    | "transfer"
    | "contribution"
    | "redemption";
  currency: Currency;
};

export type InstrumentTransactionRow = CashFlowRow & {
  accountId: string;
  instrumentId: string | null;
};
