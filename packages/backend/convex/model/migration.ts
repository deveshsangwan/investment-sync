import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { digest, utf8Bytes } from "./importLimits";
import {
  canonicalJson,
  legacyTables,
  parseJson,
  tableCountsSchema,
  type LegacyTable,
} from "./migrationValidators";

export function requireMigrationMode(sourceKind: "synthetic" | "production") {
  const isSyntheticTarget =
    process.env.APP_ENV === "development" || process.env.APP_ENV === "test";
  const isProductionTarget = process.env.APP_ENV === "production";
  if (
    process.env.MIGRATION_MODE !== sourceKind ||
    (sourceKind === "synthetic" ? !isSyntheticTarget : !isProductionTarget)
  )
    throw new Error("Migration mode does not authorize this source and target");
}

export async function requireMigration(ctx: QueryCtx, runKey: string) {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  if (!run) throw new Error("Migration run not found");

  requireMigrationMode(run.sourceKind);
  return run;
}

export async function migrationRecord(
  ctx: QueryCtx,
  runKey: string,
  legacyTable: LegacyTable,
  legacyId: string,
) {
  const record = await ctx.db
    .query("migrationRecords")
    .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
      q
        .eq("runKey", runKey)
        .eq("legacyTable", legacyTable)
        .eq("legacyId", legacyId),
    )
    .unique();
  if (!record) throw new Error(`Missing legacy ${legacyTable} reference`);

  return record;
}

export async function migrationTarget<Table extends TableNames>(
  ctx: QueryCtx,
  runKey: string,
  legacyTable: LegacyTable,
  legacyId: string,
  targetTable: Table,
  householdLegacyId?: string,
): Promise<Doc<Table>> {
  const mappings = await ctx.db
    .query("migrationMappings")
    .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
      q
        .eq("runKey", runKey)
        .eq("legacyTable", legacyTable)
        .eq("legacyId", legacyId),
    )
    .take(257);
  if (mappings.length > 256)
    throw new Error("Legacy mapping capacity exceeded");
  const matching = mappings.filter(
    (mapping) =>
      mapping.targetTable === targetTable &&
      mapping.householdLegacyId === householdLegacyId,
  );
  const mapping = matching[0];
  if (matching.length !== 1 || !mapping)
    throw new Error(`Missing or ambiguous ${targetTable} mapping`);
  const id = ctx.db.normalizeId(targetTable, mapping.targetId);
  const document = id ? await ctx.db.get(targetTable, id) : null;
  if (!document) throw new Error("Migration mapping target is missing");

  return document;
}

export async function mapTarget<Table extends TableNames>(
  ctx: MutationCtx,
  runKey: string,
  legacyTable: LegacyTable,
  legacyId: string,
  targetTable: Table,
  targetId: Id<Table>,
  householdLegacyId?: string,
) {
  return ctx.db.insert("migrationMappings", {
    runKey,
    legacyTable,
    legacyId,
    targetTable,
    targetId,
    householdLegacyId,
  });
}

export async function archiveRecord(
  ctx: MutationCtx,
  run: Doc<"migrationRuns">,
  legacyTable: LegacyTable,
  row: { id: string },
  source: unknown,
  extra: Pick<
    Doc<"migrationRecords">,
    | "batchLegacyId"
    | "rowNumber"
    | "normalizedRowJson"
    | "householdLegacyId"
    | "unsupportedReason"
  > = {},
) {
  const sourceJson = canonicalJson(source);
  if (utf8Bytes(sourceJson) > 524288)
    throw new Error("Legacy record exceeds supported document capacity");
  const recordId = await ctx.db.insert("migrationRecords", {
    runKey: run.runKey,
    legacyTable,
    legacyId: row.id,
    sourceJson,
    digest: digest(sourceJson),
    ...extra,
  });
  const counts = tableCountsSchema.parse(parseJson(run.loadedCountsJson));
  counts[legacyTable] = (counts[legacyTable] ?? 0) + 1;
  const expected = tableCountsSchema.parse(parseJson(run.expectedCountsJson));
  if (counts[legacyTable] > (expected[legacyTable] ?? 0))
    throw new Error("Legacy table count exceeds input manifest");
  await ctx.db.patch("migrationRuns", run._id, {
    loadedCountsJson: canonicalJson(counts),
    unsupportedCount:
      run.unsupportedCount + Number(Boolean(extra.unsupportedReason)),
  });

  return recordId;
}

export function requireCompleteInput(run: Doc<"migrationRuns">) {
  const expected = tableCountsSchema.parse(parseJson(run.expectedCountsJson));
  const actual = tableCountsSchema.parse(parseJson(run.loadedCountsJson));
  if (legacyTables.some((table) => expected[table] !== actual[table]))
    throw new Error(
      "Migration source record counts do not match input manifest",
    );
}
