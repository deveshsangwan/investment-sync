import { adaptLegacyRow } from "@investment-sync/importers/exact-adapter";
import { normalizedImportRowSchema } from "@investment-sync/importers/types";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { canonicalDecimal } from "@investment-sync/portfolio-domain";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalAction, internalQuery } from "./_generated/server";
import {
  digest,
  importLimits,
  parseRows,
  storageChecksumToHex,
  utf8Bytes,
} from "./model/importLimits";
import {
  migrationRecord,
  migrationTarget,
  requireCompleteInput,
  requireMigration,
} from "./model/migration";
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
  rateSchema,
  sourceFileManifestSchema,
  transactionSchema,
  userSchema,
  valuationSchema,
} from "./model/migrationValidators";
import { decodeFact } from "./model/portfolioEncoding";

export const recordsPage = internalQuery({
  args: { runKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    findings: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const run = await requireMigration(ctx, args.runKey);
    requireCompleteInput(run);
    if (args.paginationOpts.numItems > 10)
      throw new Error("Migration audit page exceeds ten source records");
    const page = await ctx.db
      .query("migrationRecords")
      .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
        q.eq("runKey", args.runKey),
      )
      .paginate(args.paginationOpts);
    const findings: string[] = [];
    for (const record of page.page) {
      try {
        await auditRecord(ctx, run, record);
      } catch (error) {
        findings.push(
          `${record.legacyTable}/${record.legacyId}: ${error instanceof Error ? error.message : "Integrity check failed"}`,
        );
      }
    }
    return {
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const scopesPage = internalQuery({
  args: { runKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    findings: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 10)
      throw new Error("Migration scope audit page exceeds ten records");
    const page = await ctx.db
      .query("portfolioHistoryScopes")
      .withIndex("by_creation_time")
      .paginate(args.paginationOpts);
    const findings: string[] = [];
    for (const scope of page.page) {
      const version = await ctx.db.get("portfolioVersions", scope.versionId);
      if (!version)
        findings.push("History scope refers to a missing portfolio version");
      for (const id of scope.factIds) {
        const fact = await ctx.db.get("portfolioHistoryFacts", id);
        if (!fact || fact.versionId !== scope.versionId)
          findings.push(
            "History scope refers to a missing or different-version fact",
          );
      }
    }
    return {
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const audit = internalAction({
  args: { runKey: v.string() },
  returns: v.object({ ok: v.boolean(), findings: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const findings: string[] = [];
    for (const reference of [
      internal.migrationAudit.recordsPage,
      internal.migrationAudit.scopesPage,
    ]) {
      let cursor: string | null = null;
      do {
        const result: {
          findings: string[];
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(reference, {
          ...args,
          paginationOpts: { cursor, numItems: 10, maximumBytesRead: 524288 },
        });
        findings.push(...result.findings);
        if (findings.length > 1000)
          throw new Error(
            "Migration has more than one thousand integrity findings",
          );
        cursor = result.isDone ? null : result.continueCursor;
      } while (cursor !== null);
    }
    return { ok: findings.length === 0, findings };
  },
});

async function auditRecord(
  ctx: QueryCtx,
  run: Doc<"migrationRuns">,
  record: Doc<"migrationRecords">,
) {
  if (
    digest(record.sourceJson) !== record.digest ||
    canonicalJson(parseJson(record.sourceJson)) !== record.sourceJson
  )
    throw new Error("Archived source checksum changed");
  if (record.unsupportedReason) throw new Error(record.unsupportedReason);
  const source = parseJson(record.sourceJson);
  switch (record.legacyTable) {
    case "users": {
      const row = userSchema.parse(source);
      const target = await migrationTarget(
        ctx,
        run.runKey,
        "users",
        row.id,
        "users",
      );
      assertEqual(
        [target.legacyId, target.clerkSubject, target.email ?? null],
        [row.id, row.clerk_user_id, row.email],
      );
      return;
    }
    case "households": {
      const row = householdSchema.parse(source);
      const target = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.id,
        "households",
      );
      const owner = await migrationTarget(
        ctx,
        run.runKey,
        "users",
        row.owner_user_id,
        "users",
      );
      assertEqual(
        [target.legacyId, target.name, target.ownerUserId],
        [row.id, row.name, owner._id],
      );
      const member = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdId", target._id).eq("userId", owner._id),
        )
        .unique();
      if (member?.role !== "owner")
        throw new Error("Household owner membership mismatch");
      if (!target.activePortfolioVersionId)
        throw new Error("Initial portfolio publication is missing");
      const version = await ctx.db.get(
        "portfolioVersions",
        target.activePortfolioVersionId,
      );
      if (
        !version ||
        version.householdId !== target._id ||
        version.publicationState !== "published"
      )
        throw new Error("Active portfolio publication is invalid");
      return;
    }
    case "household_members": {
      const row = memberSchema.parse(source);
      const target = await migrationTarget(
        ctx,
        run.runKey,
        record.legacyTable,
        row.id,
        "householdMembers",
      );
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
      assertEqual(
        [target.legacyId, target.householdId, target.userId, target.role],
        [row.id, household._id, user._id, row.role],
      );
      return;
    }
    case "accounts": {
      const row = accountSchema.parse(source);
      const target = await migrationTarget(
        ctx,
        run.runKey,
        record.legacyTable,
        row.id,
        "accounts",
      );
      const household = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.household_id,
        "households",
      );
      assertEqual(
        [
          target.legacyId,
          target.householdId,
          target.name,
          target.provider,
          target.accountType,
          target.currency,
          target.isArchived,
          target.metadataJson,
        ],
        [
          row.id,
          household._id,
          row.name,
          row.provider,
          row.account_type,
          row.currency,
          row.is_archived,
          canonicalJson(row.metadata),
        ],
      );
      return;
    }
    case "instruments": {
      const row = instrumentSchema.parse(source);
      const mappings = await ctx.db
        .query("migrationMappings")
        .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
          q
            .eq("runKey", run.runKey)
            .eq("legacyTable", "instruments")
            .eq("legacyId", row.id),
        )
        .take(257);
      if (mappings.length > 256)
        throw new Error("Instrument split capacity exceeded");
      for (const mapping of mappings) {
        if (!mapping.householdLegacyId)
          throw new Error("Household instrument mapping is missing scope");
        const household = await migrationTarget(
          ctx,
          run.runKey,
          "households",
          mapping.householdLegacyId,
          "households",
        );
        const target = await migrationTarget(
          ctx,
          run.runKey,
          "instruments",
          row.id,
          "instruments",
          mapping.householdLegacyId,
        );
        assertEqual(
          [
            target.legacyId,
            target.householdId,
            target.name,
            target.symbol ?? null,
            target.assetClass,
            target.currency,
            target.isin ?? null,
            target.exchange ?? null,
            target.providerMetadataJson,
          ],
          [
            row.id,
            household._id,
            row.name,
            row.symbol,
            row.asset_class,
            row.currency,
            row.isin,
            row.exchange,
            canonicalJson(row.provider_metadata),
          ],
        );
      }
      return;
    }
    case "import_batches": {
      const row = batchSchema.parse(source);
      const target = await migrationTarget(
        ctx,
        run.runKey,
        record.legacyTable,
        row.id,
        "importBatches",
      );
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
      assertEqual(
        [
          target.legacyId,
          target.legacyStatus,
          target.legacyDeclaredRowCount,
          target.legacyErrors,
          target.householdId,
          target.uploaderId,
          target.fileName,
          target.contentHash ?? null,
          target.parserVersion ?? null,
          target.sourceType,
          target.createdAt,
          target.processedAt ?? null,
          target.committedAt ?? null,
          target.warnings,
        ],
        [
          row.id,
          row.status,
          row.row_count,
          row.errors,
          household._id,
          uploader._id,
          row.original_file_name,
          row.file_hash,
          row.parser_version,
          row.source_type,
          Date.parse(row.uploaded_at),
          row.processed_at ? Date.parse(row.processed_at) : null,
          row.committed_at ? Date.parse(row.committed_at) : null,
          row.warnings,
        ],
      );
      const expectedStatus =
        row.status === "created"
          ? "awaiting_upload"
          : row.status === "expired"
            ? target.rowCount
              ? "parsed"
              : "failed"
            : row.status;
      if (target.status !== expectedStatus || !target.migrationRowsFinalized)
        throw new Error("Migrated batch workflow state mismatch");
      const chunks = await ctx.db
        .query("importRowChunks")
        .withIndex("by_batchId_and_attempt_and_index", (q) =>
          q.eq("batchId", target._id).eq("attempt", target.attempt),
        )
        .take(importLimits.chunks + 1);
      if (
        !target.manifest ||
        chunks.length !== target.manifest.length ||
        chunks.length > importLimits.chunks
      )
        throw new Error("Normalized chunk manifest incomplete");
      const rows = [];
      for (const [index, chunk] of chunks.entries()) {
        const expected = target.manifest[index];
        if (
          !expected ||
          chunk.index !== index ||
          expected.index !== index ||
          chunk.digest !== digest(chunk.rowsJson) ||
          chunk.digest !== expected.digest ||
          chunk.bytes !== utf8Bytes(chunk.rowsJson) ||
          chunk.bytes !== expected.bytes ||
          chunk.count !== expected.count
        )
          throw new Error("Normalized chunk integrity mismatch");
        rows.push(...parseRows(chunk.rowsJson));
      }
      if (
        rows.length !== target.rowCount ||
        utf8Bytes(JSON.stringify(rows)) !== target.normalizedBytes
      )
        throw new Error("Normalized row or byte totals mismatch");
      const file = await migrationTarget(
        ctx,
        run.runKey,
        record.legacyTable,
        row.id,
        "sourceFiles",
      );
      const expectedFile = sourceFileManifestSchema
        .parse(parseJson(run.sourceFilesJson))
        .find((entry) => entry.legacyBatchId === row.id);
      if (
        !expectedFile ||
        file.expiresAt !== Date.parse(row.expires_at) ||
        file.legacyStoragePath !== (row.storage_path ?? undefined) ||
        file.householdId !== household._id ||
        file.uploaderId !== uploader._id ||
        file.batchId !== target._id
      )
        throw new Error("Source file metadata or ownership mismatch");
      if (expectedFile.status === "available") {
        const metadata = file.storageId
          ? await ctx.db.system.get("_storage", file.storageId)
          : null;
        if (
          file.status !== "stored" ||
          !metadata ||
          metadata.size !== expectedFile.sizeBytes ||
          file.sizeBytes !== expectedFile.sizeBytes ||
          target.sizeBytes !== expectedFile.sizeBytes ||
          file.contentHash !== expectedFile.contentHash ||
          storageChecksumToHex(metadata.sha256) !== expectedFile.contentHash
        )
          throw new Error("Copied source file metadata mismatch");
      } else if (file.storageId || file.status !== "deleted")
        throw new Error("Unavailable source file must remain unavailable");
      if (row.status === "committed" && row.file_hash && row.parser_version) {
        const key = await ctx.db
          .query("importDedupeKeys")
          .withIndex("by_householdId_and_key", (q) =>
            q
              .eq("householdId", household._id)
              .eq("key", `${row.file_hash}:${row.parser_version}`),
          )
          .unique();
        if (key?.batchId !== target._id)
          throw new Error("Committed import dedupe reference mismatch");
      }
      return;
    }
    case "import_rows": {
      const row = importRowSchema.parse(source);
      const parsed = exactNormalizedImportRowSchema.safeParse(
        row.normalized_payload,
      );
      const normalized = parsed.success
        ? parsed.data
        : adaptLegacyRow(
            normalizedImportRowSchema.parse(row.normalized_payload),
          );
      assertEqual(parseJson(record.normalizedRowJson ?? "null"), normalized);
      await migrationRecord(
        ctx,
        run.runKey,
        "import_batches",
        row.import_batch_id,
      );
      return;
    }
    case "holding_snapshots":
    case "transactions":
    case "portfolio_valuations": {
      const row =
        record.legacyTable === "holding_snapshots"
          ? holdingSchema.parse(source)
          : record.legacyTable === "transactions"
            ? transactionSchema.parse(source)
            : valuationSchema.parse(source);
      const table =
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
        table,
      );
      const household = await migrationTarget(
        ctx,
        run.runKey,
        "households",
        row.household_id,
        "households",
      );
      const fact = decodeFact(target.factJson);
      const batchId =
        "import_batch_id" in row && row.import_batch_id
          ? (
              await migrationTarget(
                ctx,
                run.runKey,
                "import_batches",
                row.import_batch_id,
                "importBatches",
              )
            )._id
          : undefined;
      assertEqual(
        [
          target.legacyId,
          target.householdId,
          target.batchId ?? null,
          fact.provenance.legacyId,
        ],
        [row.id, household._id, batchId ?? null, row.id],
      );
      if ("amount" in row && fact.row.kind === "transaction")
        assertEqual(
          [
            fact.row.amount,
            fact.row.quantity ?? null,
            fact.row.price ?? null,
            fact.row.tradeDate,
            fact.row.type,
            fact.row.currency,
          ],
          [
            canonicalDecimal(row.amount),
            canonicalNullable(row.quantity),
            canonicalNullable(row.price),
            row.trade_date,
            row.type,
            row.currency,
          ],
        );
      else if ("snapshot_date" in row && fact.row.kind === "holding")
        assertEqual(
          [
            fact.row.quantity ?? null,
            fact.row.investedAmount,
            fact.row.currentValue,
            fact.row.pnlAmount ?? null,
            fact.row.pnlPercent ?? null,
            fact.row.sourceDate,
            fact.row.sourceType,
            fact.row.currency,
          ],
          [
            canonicalNullable(row.quantity),
            canonicalDecimal(row.invested_amount),
            canonicalDecimal(row.current_value),
            canonicalNullable(row.pnl_amount),
            row.pnl_percent === null ? null : Number(row.pnl_percent),
            row.snapshot_date,
            row.source_type,
            row.currency,
          ],
        );
      else if ("valuation_date" in row && fact.row.kind === "valuation")
        assertEqual(
          [
            fact.row.investedAmount,
            fact.row.currentValue,
            fact.row.pnlAmount,
            fact.row.valuationDate,
            fact.row.currency,
          ],
          [
            canonicalDecimal(row.invested_amount),
            canonicalDecimal(row.current_value),
            canonicalDecimal(row.pnl_amount),
            row.valuation_date,
            row.currency,
          ],
        );
      else throw new Error("Persisted fact kind mismatch");
      if ("account_id" in row && fact.row.kind !== "valuation") {
        const account = await migrationTarget(
          ctx,
          run.runKey,
          "accounts",
          row.account_id,
          "accounts",
        );
        if (!row.instrument_id)
          throw new Error("transaction_without_instrument");
        const instrument = await migrationTarget(
          ctx,
          run.runKey,
          "instruments",
          row.instrument_id,
          "instruments",
          row.household_id,
        );
        assertEqual(
          [
            fact.row.accountName,
            fact.row.provider,
            fact.row.instrumentName,
            fact.row.symbol ?? null,
            fact.row.assetClass,
          ],
          [
            account.name,
            account.provider,
            instrument.name,
            instrument.symbol ?? null,
            instrument.assetClass,
          ],
        );
      }
      return;
    }
    case "currency_rates": {
      const row = rateSchema.parse(source);
      if (
        row.base === "USD" &&
        row.quote === "INR" &&
        row.provider === "frankfurter"
      ) {
        const target = await migrationTarget(
          ctx,
          run.runKey,
          record.legacyTable,
          row.id,
          "currencyRates",
        );
        assertEqual(
          [
            target.rate,
            target.fetchedAt,
            target.base,
            target.quote,
            target.provider,
          ],
          [
            canonicalDecimal(row.rate),
            new Date(row.fetched_at).toISOString(),
            row.base,
            row.quote,
            row.provider,
          ],
        );
      }
      return;
    }
    case "prices":
      return;
  }
}

function canonicalNullable(value: string | null) {
  return value === null ? null : canonicalDecimal(value);
}

function assertEqual(actual: unknown, expected: unknown) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error(
      "Actual target fields differ from authoritative source values",
    );
}
