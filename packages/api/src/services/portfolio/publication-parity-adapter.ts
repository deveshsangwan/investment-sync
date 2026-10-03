import {
  accounts,
  holdingSnapshots,
  importBatches,
  instruments,
  portfolioValuations,
  transactions,
  type Database,
} from "@investment-sync/db";
import {
  adaptLegacyRow,
  exactNormalizedImportRowSchema,
  normalizedImportRowSchema,
  type NormalizedImportRow,
} from "@investment-sync/importers";
import {
  canonicalDecimal,
  type PortfolioFact,
} from "@investment-sync/portfolio-domain";
import { eq } from "drizzle-orm";

/** Test adapter over stored facts. Financial columns remain decimal strings. */
export async function loadPostgresPublicationFacts(
  db: Database,
  householdId: string,
): Promise<PortfolioFact[]> {
  const [holdings, trades, valuations] = await Promise.all([
    db
      .select({
        holding: holdingSnapshots,
        account: accounts,
        instrument: instruments,
        batch: importBatches,
      })
      .from(holdingSnapshots)
      .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
      .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
      .leftJoin(
        importBatches,
        eq(importBatches.id, holdingSnapshots.importBatchId),
      )
      .where(eq(holdingSnapshots.householdId, householdId))
      .orderBy(holdingSnapshots.createdAt, holdingSnapshots.id),
    db
      .select({
        trade: transactions,
        account: accounts,
        instrument: instruments,
        batch: importBatches,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(instruments, eq(instruments.id, transactions.instrumentId))
      .leftJoin(importBatches, eq(importBatches.id, transactions.importBatchId))
      .where(eq(transactions.householdId, householdId))
      .orderBy(transactions.createdAt, transactions.id),
    db
      .select()
      .from(portfolioValuations)
      .where(eq(portfolioValuations.householdId, householdId))
      .orderBy(portfolioValuations.createdAt, portfolioValuations.id),
  ]);

  return [
    ...holdings.map(({ holding, account, instrument, batch }, index) => {
      const legacy = normalizedImportRowSchema.parse({
        kind: "holding",
        sourceType: holding.sourceType,
        sourceDate: holding.snapshotDate,
        ...identity(account, instrument),
        currency: holding.currency,
        investedAmount: 0,
        currentValue: 0,
        pnlPercent:
          holding.pnlPercent === null ? undefined : Number(holding.pnlPercent),
        metadata: { ...holding.sourcePayload, exchange: instrument.exchange },
      });
      const row = storedRow(legacy, {
        quantity: decimal(holding.quantity),
        investedAmount: canonicalDecimal(holding.investedAmount),
        currentValue: canonicalDecimal(holding.currentValue),
        pnlAmount: decimal(holding.pnlAmount),
      });

      return { row, provenance: provenance(holding, batch, index) };
    }),
    ...trades.map(({ trade, account, instrument, batch }, index) => {
      if (!instrument) {
        throw new Error(
          "Stored transaction without an instrument cannot be published",
        );
      }

      const legacy = normalizedImportRowSchema.parse({
        kind: "transaction",
        sourceType: batch?.sourceType ?? "unknown",
        ...identity(account, instrument),
        currency: trade.currency,
        tradeDate: trade.tradeDate,
        type: trade.type,
        amount: 0,
        metadata: { ...trade.metadata, notes: trade.notes },
      });
      const row = storedRow(legacy, {
        quantity: decimal(trade.quantity),
        price: decimal(trade.price),
        amount: canonicalDecimal(trade.amount),
      });

      return {
        row,
        provenance: provenance(trade, batch, holdings.length + index),
      };
    }),
    ...valuations.map((valuation, index) => {
      const legacy = normalizedImportRowSchema.parse({
        kind: "valuation",
        sourceType: "investment_portfolio_xlsx",
        valuationDate: valuation.valuationDate,
        investedAmount: 0,
        currentValue: 0,
        currency: valuation.currency,
        metadata: valuation.metadata,
      });
      const row = storedRow(legacy, {
        investedAmount: canonicalDecimal(valuation.investedAmount),
        currentValue: canonicalDecimal(valuation.currentValue),
        pnlAmount: canonicalDecimal(valuation.pnlAmount),
      });

      // Legacy valuation rows have no batch foreign key.
      return {
        row,
        provenance: provenance(
          valuation,
          null,
          holdings.length + trades.length + index,
        ),
      };
    }),
  ];
}

function identity(
  account: typeof accounts.$inferSelect,
  instrument: typeof instruments.$inferSelect,
) {
  return {
    accountName: account.name,
    provider: account.provider,
    instrumentName: instrument.name,
    symbol: instrument.symbol ?? undefined,
    isin: instrument.isin ?? undefined,
    assetClass: instrument.assetClass,
  };
}

function decimal(value: string | null) {
  return value === null ? undefined : canonicalDecimal(value);
}

function provenance(
  record: { id: string; createdAt: Date },
  batch: typeof importBatches.$inferSelect | null,
  index: number,
) {
  return {
    batchId: batch?.id ?? `legacy:${record.id}`,
    parserVersion: batch?.parserVersion ?? "legacy-postgres",
    sequence: record.createdAt.getTime(),
    rowNumber: index + 1,
    fallbackDate: (batch?.uploadedAt ?? record.createdAt)
      .toISOString()
      .slice(0, 10),
    legacyId: record.id,
  };
}

function storedRow(
  legacy: NormalizedImportRow,
  amounts: Record<string, string | undefined>,
) {
  // Only nonfinancial metadata comes from the legacy adapter. Placeholder
  // amounts are replaced directly with authoritative Postgres numeric text.
  return exactNormalizedImportRowSchema.parse({
    ...adaptLegacyRow(legacy),
    ...amounts,
    numericProvenance: Object.fromEntries(
      Object.entries(amounts)
        .filter(([, value]) => value !== undefined)
        .map(([field]) => [field, "persisted_decimal"]),
    ),
  });
}
