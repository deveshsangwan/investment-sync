import type {
  AssetClass,
  Currency,
  ExactNormalizedImportRow,
} from "@investment-sync/importers";

export type HoldingRow = Extract<ExactNormalizedImportRow, { kind: "holding" }>;
export type TransactionRow = Extract<
  ExactNormalizedImportRow,
  { kind: "transaction" }
>;
export type ValuationRow = Extract<
  ExactNormalizedImportRow,
  { kind: "valuation" }
>;

export interface ImportProvenance {
  batchId: string;
  parserVersion: string;
  sequence: number;
  rowNumber: number;
  fallbackDate: string;
  legacyId?: string;
}

export interface PortfolioFact {
  row: ExactNormalizedImportRow;
  provenance: ImportProvenance;
}

export type FactIdentity =
  | {
      kind: "holding";
      accountKey: string;
      instrumentKey: string;
      positionKey: string;
      sourceGroupKey: string;
      canonicalPositionKey: string;
      snapshotKey: string;
      snapshotDate: string;
    }
  | {
      kind: "transaction";
      accountKey: string;
      instrumentKey: string;
      positionKey: string;
      occurrenceKey: string;
    }
  | { kind: "valuation"; valuationKey: string };

export interface IdentifiedFact extends PortfolioFact {
  identity: FactIdentity;
}

export interface PublicationInput {
  existingFacts: PortfolioFact[];
  batch?: {
    id: string;
    parserVersion: string;
    sequence: number;
    fallbackDate: string;
    rows: ExactNormalizedImportRow[];
  };
}

export interface HoldingFact {
  row: HoldingRow;
  provenance: ImportProvenance;
  accountKey: string;
  instrumentKey: string;
  positionKey: string;
  canonicalPositionKey: string;
  sourceGroupKey: string;
  snapshotDate: string;
  factKey: string;
}

export interface TransactionFact {
  row: TransactionRow;
  provenance: ImportProvenance;
  accountKey: string;
  instrumentKey: string;
  positionKey: string;
  occurrenceKey: string;
}

export interface NativeTotal {
  currency: Currency;
  investedAmount: string;
  currentValue: string;
  pnlAmount: string;
}

export interface NativeTimelinePoint {
  snapshotDate: string;
  totals: NativeTotal[];
}

export interface PositionProjection {
  positionKey: string;
  status: "current" | "exited";
  holding: HoldingFact;
  history: HoldingFact[];
  transactions: TransactionFact[];
  // The legacy asset-class XIRR uses all accounts for the instrument.
  instrumentHistory: HoldingFact[];
  instrumentTransactions: TransactionFact[];
}

export interface PortfolioProjection {
  projectorVersion: "portfolio-v1";
  asOfDate: string | null;
  positions: PositionProjection[];
  detailPositions?: PositionProjection[];
  totals: NativeTotal[];
  assetClasses: Array<{
    assetClass: AssetClass;
    totals: NativeTotal[];
    timeline: NativeTimelinePoint[];
  }>;
  timeline: NativeTimelinePoint[];
  hasExplicitValuations: boolean;
  valuations: ValuationRow[];
  cashFlows: TransactionFact[];
}

export interface PortfolioPublication {
  facts: PortfolioFact[];
  factsToPersist: IdentifiedFact[];
  identifiedFacts: IdentifiedFact[];
  projection: PortfolioProjection;
  reconciliation: {
    factCount: number;
    holdingCount: number;
    transactionCount: number;
    valuationCount: number;
    currentCount: number;
    exitedCount: number;
    nativeTotals: NativeTotal[];
  };
  digest: string;
}

export type ValuationQuote =
  | { status: "unavailable" }
  | {
      status: "fresh" | "stale";
      rate: string;
      fetchedAt: string;
      provider: "frankfurter";
    };
