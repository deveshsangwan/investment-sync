import { z } from "zod";
import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { normalizedImportRowSchema } from "@investment-sync/importers/types";
import {
  buildPortfolioPublication,
  canonicalDecimal,
  type PortfolioFact,
} from "@investment-sync/portfolio-domain";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { migrationRecord, migrationTarget } from "./migration";
import {
  accountSchema,
  batchSchema,
  canonicalJson,
  holdingSchema,
  instrumentSchema,
  parseJson,
  transactionSchema,
  valuationSchema,
} from "./migrationValidators";

export type LegacyFactSource =
  | z.infer<typeof holdingSchema>
  | z.infer<typeof transactionSchema>
  | z.infer<typeof valuationSchema>;

export function expectedMigratedFact(input: {
  source: LegacyFactSource;
  ordinal: number;
  account?: z.infer<typeof accountSchema>;
  instrument?: z.infer<typeof instrumentSchema>;
  batch?: z.infer<typeof batchSchema>;
}): PortfolioFact {
  const { source, ordinal, account, instrument, batch } = input;
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new Error("Missing authoritative migrated fact ordinal");

  const identity =
    account && instrument
      ? {
          accountName: account.name,
          provider: account.provider,
          instrumentName: instrument.name,
          symbol: instrument.symbol ?? undefined,
          isin: instrument.isin ?? undefined,
          assetClass: instrument.asset_class,
          currency: source.currency,
        }
      : undefined;
  if (!("valuation_date" in source) && !identity)
    throw new Error("Migrated fact is missing authoritative source parents");

  const legacy = normalizedImportRowSchema.parse(
    "valuation_date" in source
      ? {
          kind: "valuation",
          sourceType: "investment_portfolio_xlsx",
          valuationDate: source.valuation_date,
          investedAmount: 0,
          currentValue: 0,
          currency: source.currency,
          metadata: source.metadata,
        }
      : "snapshot_date" in source
        ? {
            kind: "holding",
            sourceType: source.source_type,
            sourceDate: source.snapshot_date,
            ...identity,
            investedAmount: 0,
            currentValue: 0,
            pnlPercent:
              source.pnl_percent === null
                ? undefined
                : Number(source.pnl_percent),
            metadata: {
              ...source.source_payload,
              exchange: instrument?.exchange ?? undefined,
            },
          }
        : {
            kind: "transaction",
            sourceType: batch?.source_type ?? "unknown",
            ...identity,
            tradeDate: source.trade_date,
            type: source.type,
            amount: 0,
            metadata: { ...source.metadata, notes: source.notes },
          },
  );
  const amounts = sourceFinancialAmounts(source);
  const defined = Object.fromEntries(
    Object.entries(amounts).flatMap(([field, value]) =>
      value === null ? [] : [[field, canonicalDecimal(value)]],
    ),
  );
  const row = exactNormalizedImportRowSchema.parse({
    ...adaptLegacyRow(legacy),
    ...defined,
    numericProvenance: Object.fromEntries(
      Object.keys(defined).map((field) => [field, "persisted_decimal"]),
    ),
  });
  const legacyBatchId =
    "import_batch_id" in source ? source.import_batch_id : null;

  return {
    row,
    provenance: {
      legacyId: source.id,
      batchId: legacyBatchId ?? "legacy:" + source.id,
      parserVersion: batch?.parser_version ?? "legacy-postgres",
      sequence: Date.parse(source.created_at),
      rowNumber: ordinal,
      fallbackDate: new Date(batch ? batch.uploaded_at : source.created_at)
        .toISOString()
        .slice(0, 10),
    },
  };
}

export function expectedMigratedIdentity(fact: PortfolioFact) {
  const identified = buildPortfolioPublication({ existingFacts: [fact] })
    .identifiedFacts[0];
  if (!identified) throw new Error("Expected migrated fact has no identity");

  return identified.identity;
}

export async function auditMigratedFact(
  ctx: QueryCtx,
  run: Doc<"migrationRuns">,
  record: Doc<"migrationRecords">,
) {
  const source = parseJson(record.sourceJson);
  const row =
    record.legacyTable === "holding_snapshots"
      ? holdingSchema.parse(source)
      : record.legacyTable === "transactions"
        ? transactionSchema.parse(source)
        : valuationSchema.parse(source);
  const targetTable =
    record.legacyTable === "holding_snapshots"
      ? "holdingSnapshots"
      : record.legacyTable === "transactions"
        ? "transactions"
        : "portfolioValuations";
  const target = await migrationTarget(
    ctx,
    run.runKey,
    record.legacyTable,
    row.id,
    targetTable,
  );
  const household = await migrationTarget(
    ctx,
    run.runKey,
    "households",
    row.household_id,
    "households",
  );
  const readSource = async (
    table: "accounts" | "instruments" | "import_batches",
    id: string,
  ) =>
    parseJson((await migrationRecord(ctx, run.runKey, table, id)).sourceJson);
  const batchLegacyId = "import_batch_id" in row ? row.import_batch_id : null;
  const batch = batchLegacyId
    ? batchSchema.parse(await readSource("import_batches", batchLegacyId))
    : undefined;
  const account =
    "account_id" in row
      ? accountSchema.parse(await readSource("accounts", row.account_id))
      : undefined;
  const instrument =
    "instrument_id" in row && row.instrument_id
      ? instrumentSchema.parse(
          await readSource("instruments", row.instrument_id),
        )
      : undefined;
  const ordinal = record.rowNumber;
  if (ordinal === undefined || ordinal > run.nextFactOrdinal)
    throw new Error("Missing authoritative migrated fact ordinal");
  const expected = expectedMigratedFact({
    source: row,
    ordinal,
    account,
    instrument,
    batch,
  });
  const batchId = batchLegacyId
    ? (
        await migrationTarget(
          ctx,
          run.runKey,
          "import_batches",
          batchLegacyId,
          "importBatches",
        )
      )._id
    : null;

  assertEqual(parseJson(target.factJson), expected);
  assertEqual(
    [target.legacyId, target.householdId, target.batchId ?? null, target.key],
    [
      row.id,
      household._id,
      batchId,
      JSON.stringify([expected.provenance.batchId, ordinal]),
    ],
  );
  const identity = expectedMigratedIdentity(expected);
  if (identity.kind === "holding" && "sourceGroupKey" in target) {
    assertEqual(
      [
        target.date,
        target.positionKey,
        target.instrumentKey,
        target.sourceGroupKey,
      ],
      [
        identity.snapshotDate,
        identity.positionKey,
        identity.instrumentKey,
        identity.sourceGroupKey,
      ],
    );
    const alias = await ctx.db
      .query("legacyHoldingAliases")
      .withIndex("by_householdId_and_legacyId", (q) =>
        q.eq("householdId", household._id).eq("legacyId", row.id),
      )
      .unique();
    assertEqual(alias?.positionKey, identity.positionKey);
  } else if (
    identity.kind === "transaction" &&
    "occurrenceKey" in target &&
    expected.row.kind === "transaction"
  ) {
    assertEqual(
      [
        target.date,
        target.positionKey,
        target.instrumentKey,
        target.occurrenceKey,
      ],
      [
        expected.row.tradeDate,
        identity.positionKey,
        identity.instrumentKey,
        identity.occurrenceKey,
      ],
    );
  } else if (
    identity.kind === "valuation" &&
    expected.row.kind === "valuation"
  ) {
    assertEqual(target.date, expected.row.valuationDate);
  } else {
    throw new Error("Migrated fact document kind mismatch");
  }
}

function assertEqual(actual: unknown, expected: unknown) {
  if (canonicalJson(actual ?? null) !== canonicalJson(expected ?? null))
    throw new Error(
      "Actual target fact differs from authoritative source metadata, provenance or identity",
    );
}

function sourceFinancialAmounts(
  source: LegacyFactSource,
): Record<string, string | null> {
  return "amount" in source
    ? {
        amount: source.amount,
        quantity: source.quantity,
        price: source.price,
      }
    : {
        investedAmount: source.invested_amount,
        currentValue: source.current_value,
        pnlAmount: source.pnl_amount,
        ...("quantity" in source ? { quantity: source.quantity } : {}),
      };
}
