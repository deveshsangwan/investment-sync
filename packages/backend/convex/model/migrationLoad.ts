import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { normalizedImportRowSchema } from "@investment-sync/importers/types";
import {
  accountKey,
  buildPortfolioPublication,
  canonicalDecimal,
  instrumentKey,
  type PortfolioFact,
} from "@investment-sync/portfolio-domain";
import { z } from "zod";
import { classifyQuoteAge, scheduleQuoteExpiry } from "./currencyRates";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  archiveRecord,
  mapTarget,
  migrationRecord,
  migrationTarget,
} from "./migration";
import {
  accountSchema,
  batchSchema,
  canonicalJson,
  holdingSchema,
  householdSchema,
  importRowSchema,
  instrumentSchema,
  memberSchema,
  parseJson,
  priceSchema,
  rateSchema,
  sourceFileManifestSchema,
  transactionSchema,
  userSchema,
  valuationSchema,
  type LegacyTable,
} from "./migrationValidators";

export async function loadLegacyRecord(
  ctx: MutationCtx,
  run: Doc<"migrationRuns">,
  legacyTable: LegacyTable,
  value: unknown,
) {
  switch (legacyTable) {
    case "users": {
      const row = userSchema.parse(value);
      const existing = await ctx.db
        .query("users")
        .withIndex("by_clerk_subject", (q) =>
          q.eq("clerkSubject", row.clerk_user_id),
        )
        .unique();
      if (existing) throw new Error("Clerk identity collision");
      const id = await ctx.db.insert("users", {
        legacyId: row.id,
        clerkSubject: row.clerk_user_id,
        email: row.email ?? undefined,
      });
      await mapTarget(ctx, run.runKey, legacyTable, row.id, "users", id);
      await archiveRecord(ctx, run, legacyTable, row, value);
      return;
    }
    case "households": {
      const row = householdSchema.parse(value);
      const owner = await migrationTarget(
        ctx,
        run.runKey,
        "users",
        row.owner_user_id,
        "users",
      );
      const existing = await ctx.db
        .query("households")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", owner._id))
        .unique();
      if (existing) throw new Error("Household owner collision");
      const id = await ctx.db.insert("households", {
        legacyId: row.id,
        ownerUserId: owner._id,
        name: row.name,
      });
      await mapTarget(ctx, run.runKey, legacyTable, row.id, "households", id);
      await archiveRecord(ctx, run, legacyTable, row, value, {
        householdLegacyId: row.id,
      });
      return;
    }
    case "household_members": {
      const row = memberSchema.parse(value);
      const household = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.household_id,
        "households",
      );
      const user = await migrationTarget(
        ctx,
        run.runKey,
        "users",
        row.user_id,
        "users",
      );
      if (row.role === "owner" && household.ownerUserId !== user._id)
        throw new Error("Household owner membership mismatch");
      const existing = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdId", household._id).eq("userId", user._id),
        )
        .unique();
      if (existing) throw new Error("Household membership collision");
      const id = await ctx.db.insert("householdMembers", {
        legacyId: row.id,
        householdId: household._id,
        userId: user._id,
        role: row.role,
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        row.id,
        "householdMembers",
        id,
      );
      await archiveRecord(ctx, run, legacyTable, row, value, {
        householdLegacyId: row.household_id,
      });
      return;
    }
    case "accounts": {
      const row = accountSchema.parse(value);
      const household = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.household_id,
        "households",
      );
      const key = accountKey({ accountName: row.name, provider: row.provider });
      const existing = await ctx.db
        .query("accounts")
        .withIndex("by_householdId_and_key", (q) =>
          q.eq("householdId", household._id).eq("key", key),
        )
        .unique();
      if (existing) throw new Error("Account canonical key collision");
      const id = await ctx.db.insert("accounts", {
        legacyId: row.id,
        householdId: household._id,
        key,
        name: row.name,
        provider: row.provider,
        accountType: row.account_type,
        currency: row.currency,
        isArchived: row.is_archived,
        metadataJson: canonicalJson(row.metadata),
      });
      await mapTarget(ctx, run.runKey, legacyTable, row.id, "accounts", id);
      await archiveRecord(ctx, run, legacyTable, row, value, {
        householdLegacyId: row.household_id,
      });
      return;
    }
    case "instruments": {
      const row = instrumentSchema.parse(value);
      await archiveRecord(ctx, run, legacyTable, row, value);
      return;
    }
    case "import_batches": {
      const row = batchSchema.parse(value);
      const household = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.household_id,
        "households",
      );
      const uploader = await migrationTarget(
        ctx,
        run.runKey,
        "users",
        row.uploaded_by_user_id,
        "users",
      );
      const membership = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdId", household._id).eq("userId", uploader._id),
        )
        .unique();
      if (!membership)
        throw new Error("Import uploader is not a household member");
      const status =
        row.status === "created"
          ? "awaiting_upload"
          : row.status === "expired"
            ? "failed"
            : row.status;
      const id = await ctx.db.insert("importBatches", {
        legacyId: row.id,
        legacyStatus: row.status,
        legacyDeclaredRowCount: row.row_count,
        legacyErrors: row.errors,
        householdId: household._id,
        uploaderId: uploader._id,
        fileName: row.original_file_name,
        sizeBytes: 0,
        status,
        attempt: 1,
        createdAt: Date.parse(row.uploaded_at),
        rowCount: 0,
        normalizedBytes: 2,
        previewRowsJson: "[]",
        warnings: row.warnings,
        errorMessage: row.errors.length ? row.errors.join("\n") : undefined,
        contentHash: row.file_hash ?? undefined,
        parserVersion: row.parser_version ?? undefined,
        sourceType: row.source_type,
        processedAt: row.processed_at
          ? Date.parse(row.processed_at)
          : undefined,
        committedAt: row.committed_at
          ? Date.parse(row.committed_at)
          : undefined,
      });
      const expectedFile = sourceFileManifestSchema
        .parse(parseJson(run.sourceFilesJson))
        .find((entry) => entry.legacyBatchId === row.id);
      if (
        !expectedFile ||
        Date.parse(expectedFile.expiresAt) !== Date.parse(row.expires_at) ||
        expectedFile.legacyStoragePath !== row.storage_path
      )
        throw new Error("Legacy batch does not match source file manifest");
      const hasPossibleFile = expectedFile.status === "available";
      if (hasPossibleFile && (row.status === "expired" || !row.storage_path))
        throw new Error(
          "Expired or unreferenced legacy file cannot be available",
        );
      const fileId = await ctx.db.insert("sourceFiles", {
        batchId: id,
        householdId: household._id,
        uploaderId: uploader._id,
        status: hasPossibleFile ? "reserved" : "deleted",
        expiresAt: Date.parse(row.expires_at),
        contentHash: row.file_hash ?? undefined,
        legacyStoragePath: row.storage_path ?? undefined,
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        row.id,
        "importBatches",
        id,
      );
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        row.id,
        "sourceFiles",
        fileId,
      );
      await archiveRecord(ctx, run, legacyTable, row, value, {
        householdLegacyId: row.household_id,
      });
      if (status === "committed" && row.file_hash && row.parser_version) {
        const key = `${row.file_hash}:${row.parser_version}`;
        const existing = await ctx.db
          .query("importDedupeKeys")
          .withIndex("by_householdId_and_key", (q) =>
            q.eq("householdId", household._id).eq("key", key),
          )
          .unique();
        if (existing) throw new Error("Committed import dedupe collision");
        await ctx.db.insert("importDedupeKeys", {
          householdId: household._id,
          key,
          batchId: id,
        });
      }
      return;
    }
    case "import_rows": {
      const row = importRowSchema.parse(value);
      const batch = await migrationTarget(
        ctx,
        run.runKey,
        "import_batches",
        row.import_batch_id,
        "importBatches",
      );
      if (batch.migrationRowsFinalized)
        throw new Error("Cannot add rows after batch finalization");
      const duplicate = await ctx.db
        .query("migrationRecords")
        .withIndex(
          "by_runKey_and_legacyTable_and_batchLegacyId_and_rowNumber",
          (q) =>
            q
              .eq("runKey", run.runKey)
              .eq("legacyTable", legacyTable)
              .eq("batchLegacyId", row.import_batch_id)
              .eq("rowNumber", row.row_number),
        )
        .unique();
      if (duplicate) throw new Error("Normalized row number collision");
      const normalized = exactNormalizedImportRowSchema.safeParse(
        row.normalized_payload,
      );
      const adapted = normalized.success
        ? normalized.data
        : adaptLegacyRow(
            normalizedImportRowSchema.parse(row.normalized_payload),
          );
      const recordId = await archiveRecord(ctx, run, legacyTable, row, value, {
        batchLegacyId: row.import_batch_id,
        rowNumber: row.row_number,
        normalizedRowJson: JSON.stringify(adapted),
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        row.id,
        "migrationRecords",
        recordId,
      );
      return;
    }
    case "holding_snapshots":
    case "transactions":
    case "portfolio_valuations":
      await loadFact(ctx, run, legacyTable, value);
      return;
    case "currency_rates": {
      const row = rateSchema.parse(value);
      if (
        row.base === "USD" &&
        row.quote === "INR" &&
        row.provider === "frankfurter"
      ) {
        const status = classifyQuoteAge(
          row.fetched_at,
          Date.parse(run.evaluationTime),
        );
        const existing = await ctx.db
          .query("currencyRates")
          .withIndex("by_base_and_quote_and_provider", (q) =>
            q
              .eq("base", "USD")
              .eq("quote", "INR")
              .eq("provider", "frankfurter"),
          )
          .unique();
        if (existing) throw new Error("Currency rate key collision");
        const id = await ctx.db.insert("currencyRates", {
          base: "USD",
          quote: "INR",
          provider: "frankfurter",
          rate: canonicalDecimal(row.rate),
          fetchedAt: new Date(row.fetched_at).toISOString(),
          status,
          refreshRevision: 1,
          quoteRevision: 1,
        });
        await scheduleQuoteExpiry(ctx, row.fetched_at, 1);
        await mapTarget(
          ctx,
          run.runKey,
          legacyTable,
          row.id,
          "currencyRates",
          id,
        );
      }
      await archiveRecord(ctx, run, legacyTable, row, value);
      return;
    }
    case "prices": {
      const row = priceSchema.parse(value);
      await migrationRecord(ctx, run.runKey, "instruments", row.instrument_id);
      await archiveRecord(ctx, run, legacyTable, row, value);
      return;
    }
  }
}

async function loadFact(
  ctx: MutationCtx,
  run: Doc<"migrationRuns">,
  legacyTable: "holding_snapshots" | "transactions" | "portfolio_valuations",
  value: unknown,
) {
  const source =
    legacyTable === "holding_snapshots"
      ? holdingSchema.parse(value)
      : legacyTable === "transactions"
        ? transactionSchema.parse(value)
        : valuationSchema.parse(value);
  const household = await migrationTarget(
    ctx,
    run.runKey,
    "households",
    source.household_id,
    "households",
  );
  const batchLegacyId =
    "import_batch_id" in source ? source.import_batch_id : null;
  const batch = batchLegacyId
    ? await migrationTarget(
        ctx,
        run.runKey,
        "import_batches",
        batchLegacyId,
        "importBatches",
      )
    : null;
  if (batch && batch.householdId !== household._id)
    throw new Error("Fact batch belongs to another household");
  const provenance = {
    legacyId: source.id,
    batchId: batchLegacyId ?? `legacy:${source.id}`,
    parserVersion: batch?.parserVersion ?? "legacy-postgres",
    sequence: Date.parse(source.created_at),
    rowNumber: run.nextFactOrdinal + 1,
    fallbackDate: new Date(batch?.createdAt ?? Date.parse(source.created_at))
      .toISOString()
      .slice(0, 10),
  };
  let fact: PortfolioFact;

  if ("valuation_date" in source) {
    const legacy = normalizedImportRowSchema.parse({
      kind: "valuation",
      sourceType: "investment_portfolio_xlsx",
      valuationDate: source.valuation_date,
      investedAmount: 0,
      currentValue: 0,
      currency: source.currency,
      metadata: source.metadata,
    });
    fact = {
      row: storedRow(legacy, {
        investedAmount: source.invested_amount,
        currentValue: source.current_value,
        pnlAmount: source.pnl_amount,
      }),
      provenance,
    };
  } else {
    const account = await migrationTarget(
      ctx,
      run.runKey,
      "accounts",
      source.account_id,
      "accounts",
    );
    if (account.householdId !== household._id)
      throw new Error("Fact account belongs to another household");
    if (!source.instrument_id) {
      await archiveRecord(ctx, run, legacyTable, source, value, {
        householdLegacyId: source.household_id,
        unsupportedReason: "transaction_without_instrument",
      });
      return;
    }
    const instrument = await householdInstrument(
      ctx,
      run.runKey,
      source.instrument_id,
      source.household_id,
      household,
    );
    const identity = {
      accountName: account.name,
      provider: account.provider,
      instrumentName: instrument.name,
      symbol: instrument.symbol,
      isin: instrument.isin,
      assetClass: instrument.assetClass,
      currency: source.currency,
    };
    if ("snapshot_date" in source) {
      const legacy = normalizedImportRowSchema.parse({
        kind: "holding",
        sourceType: source.source_type,
        sourceDate: source.snapshot_date,
        ...identity,
        investedAmount: 0,
        currentValue: 0,
        pnlPercent:
          source.pnl_percent === null ? undefined : Number(source.pnl_percent),
        metadata: { ...source.source_payload, exchange: instrument.exchange },
      });
      fact = {
        row: storedRow(legacy, {
          quantity: source.quantity,
          investedAmount: source.invested_amount,
          currentValue: source.current_value,
          pnlAmount: source.pnl_amount,
        }),
        provenance,
      };
    } else {
      const legacy = normalizedImportRowSchema.parse({
        kind: "transaction",
        sourceType: batch?.sourceType ?? "unknown",
        ...identity,
        tradeDate: source.trade_date,
        type: source.type,
        amount: 0,
        metadata: { ...source.metadata, notes: source.notes },
      });
      fact = {
        row: storedRow(legacy, {
          quantity: source.quantity,
          price: source.price,
          amount: source.amount,
        }),
        provenance,
      };
    }
  }

  const identified = buildPortfolioPublication({ existingFacts: [fact] })
    .identifiedFacts[0];
  if (!identified) throw new Error("Missing identified legacy fact");
  const key = JSON.stringify([provenance.batchId, provenance.rowNumber]);
  const targetTable =
    legacyTable === "holding_snapshots"
      ? "holdingSnapshots"
      : legacyTable === "transactions"
        ? "transactions"
        : "portfolioValuations";
  const collision = await ctx.db
    .query(targetTable)
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", household._id).eq("key", key),
    )
    .unique();
  if (collision) throw new Error("Legacy immutable provenance key collision");
  const shared = {
    legacyId: source.id,
    householdId: household._id,
    batchId: batch?._id,
    key,
    factJson: JSON.stringify(fact),
  };
  switch (identified.identity.kind) {
    case "holding": {
      const identity = identified.identity;
      const id = await ctx.db.insert("holdingSnapshots", {
        ...shared,
        positionKey: identity.positionKey,
        instrumentKey: identity.instrumentKey,
        sourceGroupKey: identity.sourceGroupKey,
        date: identity.snapshotDate,
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        source.id,
        "holdingSnapshots",
        id,
      );
      await ctx.db.insert("legacyHoldingAliases", {
        householdId: household._id,
        legacyId: source.id,
        positionKey: identity.positionKey,
      });
      break;
    }
    case "transaction": {
      if (fact.row.kind !== "transaction")
        throw new Error("Legacy transaction kind mismatch");
      const identity = identified.identity;
      const id = await ctx.db.insert("transactions", {
        ...shared,
        positionKey: identity.positionKey,
        instrumentKey: identity.instrumentKey,
        occurrenceKey: identity.occurrenceKey,
        date: fact.row.tradeDate,
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        source.id,
        "transactions",
        id,
      );
      break;
    }
    case "valuation": {
      if (fact.row.kind !== "valuation")
        throw new Error("Legacy valuation kind mismatch");
      const id = await ctx.db.insert("portfolioValuations", {
        ...shared,
        date: fact.row.valuationDate,
      });
      await mapTarget(
        ctx,
        run.runKey,
        legacyTable,
        source.id,
        "portfolioValuations",
        id,
      );
      break;
    }
  }
  await archiveRecord(ctx, run, legacyTable, source, value, {
    householdLegacyId: source.household_id,
    rowNumber: provenance.rowNumber,
  });
  await ctx.db.patch("migrationRuns", run._id, {
    nextFactOrdinal: run.nextFactOrdinal + 1,
    maximumFactSequence: Math.max(run.maximumFactSequence, provenance.sequence),
  });
}

async function householdInstrument(
  ctx: MutationCtx,
  runKey: string,
  legacyId: string,
  householdLegacyId: string,
  household: Doc<"households">,
) {
  const source = await migrationRecord(ctx, runKey, "instruments", legacyId);
  const row = instrumentSchema.parse(parseJson(source.sourceJson));
  const key = instrumentKey({
    instrumentName: row.name,
    symbol: row.symbol ?? undefined,
    assetClass: row.asset_class,
    currency: row.currency,
  });
  const existing = await ctx.db
    .query("instruments")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", household._id).eq("key", key),
    )
    .unique();
  if (existing) {
    if (existing.legacyId !== legacyId)
      throw new Error("Instrument canonical key collision within household");
    return existing;
  }

  const id = await ctx.db.insert("instruments", {
    legacyId,
    householdId: household._id,
    key,
    name: row.name,
    symbol: row.symbol ?? undefined,
    assetClass: row.asset_class,
    currency: row.currency,
    isin: row.isin ?? undefined,
    exchange: row.exchange ?? undefined,
    providerMetadataJson: canonicalJson(row.provider_metadata),
  });
  await mapTarget(
    ctx,
    runKey,
    "instruments",
    legacyId,
    "instruments",
    id,
    householdLegacyId,
  );
  const result = await ctx.db.get("instruments", id);
  if (!result) throw new Error("Missing inserted household instrument");

  return result;
}

function storedRow(
  legacy: z.infer<typeof normalizedImportRowSchema>,
  amounts: Record<string, string | null>,
) {
  const defined = Object.fromEntries(
    Object.entries(amounts)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [
        key,
        value === null ? undefined : canonicalDecimal(value),
      ]),
  );
  return exactNormalizedImportRowSchema.parse({
    ...adaptLegacyRow(legacy),
    ...defined,
    numericProvenance: Object.fromEntries(
      Object.keys(defined).map((key) => [key, "persisted_decimal"]),
    ),
  });
}
