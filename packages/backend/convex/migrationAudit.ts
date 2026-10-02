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
import { digest, storageChecksumToHex } from "./model/importLimits";
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
  householdSchema,
  importRowSchema,
  instrumentSchema,
  memberSchema,
  parseJson,
  rateSchema,
  sourceFileManifestSchema,
  userSchema,
} from "./model/migrationValidators";
import { auditMigratedFact } from "./model/migrationFactAudit";
import { auditPackedNormalizedRows } from "./model/migrationRowAudit";

export const recordsPage = internalQuery({
  args: { runKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    findings: v.array(v.string()),
    legacyBatchIds: v.array(v.string()),
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
      legacyBatchIds: page.page
        .filter((record) => record.legacyTable === "import_batches")
        .map((record) => record.legacyId),
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
      internal.migrationAudit.storagePage,
    ]) {
      let cursor: string | null = null;
      do {
        const result: {
          findings: string[];
          legacyBatchIds?: string[];
          isDone: boolean;
          continueCursor: string;
        } = await ctx.runQuery(reference, {
          ...args,
          paginationOpts: { cursor, numItems: 10, maximumBytesRead: 524288 },
        });
        findings.push(...result.findings);
        for (const legacyBatchId of result.legacyBatchIds ?? []) {
          try {
            await auditPackedNormalizedRows(ctx, {
              runKey: args.runKey,
              legacyBatchId,
            });
          } catch (error) {
            findings.push(
              `import_batches/${legacyBatchId}: ${error instanceof Error ? error.message : "Normalized row source comparison failed"}`,
            );
          }
        }
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

export const normalizedBatchState = internalQuery({
  args: { runKey: v.string(), legacyBatchId: v.string() },
  returns: v.object({
    rowCount: v.number(),
    normalizedBytes: v.number(),
    previewRowsJson: v.string(),
    manifestJson: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    if (!batch.manifest || !batch.migrationRowsFinalized)
      throw new Error("Normalized batch staging is incomplete");

    return {
      rowCount: batch.rowCount,
      normalizedBytes: batch.normalizedBytes,
      previewRowsJson: batch.previewRowsJson,
      manifestJson: JSON.stringify(batch.manifest),
    };
  },
});

export const sourceNormalizedRowsPage = internalQuery({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    rowsJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 20)
      throw new Error("Normalized source audit page exceeds twenty records");
    const page = await ctx.db
      .query("migrationRecords")
      .withIndex(
        "by_runKey_and_legacyTable_and_batchLegacyId_and_rowNumber",
        (q) =>
          q
            .eq("runKey", args.runKey)
            .eq("legacyTable", "import_rows")
            .eq("batchLegacyId", args.legacyBatchId),
      )
      .paginate(args.paginationOpts);
    const rows = page.page.map((record) => {
      if (digest(record.sourceJson) !== record.digest)
        throw new Error("Normalized source checksum changed");
      const source = importRowSchema.parse(parseJson(record.sourceJson));
      if (
        source.import_batch_id !== args.legacyBatchId ||
        source.row_number !== record.rowNumber ||
        source.id !== record.legacyId
      )
        throw new Error("Normalized source row identity or order changed");
      const exact = exactNormalizedImportRowSchema.safeParse(
        source.normalized_payload,
      );
      const row = exact.success
        ? exact.data
        : adaptLegacyRow(
            normalizedImportRowSchema.parse(source.normalized_payload),
          );

      return { rowNumber: source.row_number, row };
    });

    return {
      rowsJson: JSON.stringify(rows),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const packedChunksPage = internalQuery({
  args: {
    runKey: v.string(),
    legacyBatchId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    chunksJson: v.string(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 10)
      throw new Error("Normalized chunk audit page exceeds ten records");
    const batch = await migrationTarget(
      ctx,
      args.runKey,
      "import_batches",
      args.legacyBatchId,
      "importBatches",
    );
    const page = await ctx.db
      .query("importRowChunks")
      .withIndex("by_batchId_and_attempt_and_index", (q) =>
        q.eq("batchId", batch._id).eq("attempt", batch.attempt),
      )
      .paginate(args.paginationOpts);

    return {
      chunksJson: JSON.stringify(page.page),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const storagePage = internalQuery({
  args: { runKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    findings: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireMigration(ctx, args.runKey);
    if (args.paginationOpts.numItems > 10)
      throw new Error("Migration storage audit page exceeds ten records");
    const page = await ctx.db.system
      .query("_storage")
      .paginate(args.paginationOpts);
    const findings: string[] = [];
    for (const stored of page.page) {
      const file = await ctx.db
        .query("sourceFiles")
        .withIndex("by_storageId", (q) => q.eq("storageId", stored._id))
        .unique();
      if (!file || file.status !== "stored")
        findings.push(
          "Unclaimed storage object remains in the migration target",
        );
    }

    return {
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
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
      assertEqual(
        [record.batchLegacyId, record.rowNumber],
        [row.import_batch_id, row.row_number],
      );
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
      await auditMigratedFact(ctx, run, record);
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

function assertEqual(actual: unknown, expected: unknown) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error(
      "Actual target fields differ from authoritative source values",
    );
}
