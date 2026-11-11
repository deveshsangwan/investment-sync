import { withMutationDiagnostics } from "./model/errors";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { exactNormalizedHoldingRowSchema } from "@investment-sync/importers/exact-types";
import { policyPositionKey } from "@investment-sync/portfolio-domain";
import {
  canonicalizeDecimal,
  FinancialDecimal,
} from "@investment-sync/importers/numeric";
import {
  manualPolicyInputSchema,
  manualPolicyValuesSchema,
} from "../src/manual-entry";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCurrentMembership, requireOwner } from "./model/auth";
import { digest, parseRows, utf8Bytes } from "./model/importLimits";
import { batchToView } from "./model/imports";
import { batchView } from "./model/importValidators";
import { requireApplicationWritesEnabled } from "./model/migrationFreeze";
import { commitBatch } from "./model/publication";
import { decodeFact } from "./model/portfolioEncoding";

const valuesValidator = v.object({
  investedAmount: v.string(),
  currentValue: v.string(),
  sourceDate: v.string(),
});
const resultValidator = v.object({
  policyId: v.string(),
  batchId: v.id("importBatches"),
});
const policyLimit = 64;

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      canEditNames: v.boolean(),
      provider: v.string(),
      name: v.string(),
      values: v.union(valuesValidator, v.null()),
      draftValues: v.union(valuesValidator, v.null()),
      entry: v.union(batchView, v.null()),
    }),
  ),
  handler: async (ctx) => {
    const { household } = await requireCurrentMembership(ctx);
    const policies = await ctx.db
      .query("manualPolicies")
      .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
      .order("desc")
      .take(policyLimit);

    const manual = await Promise.all(
      policies.map(async (policy) => {
        const batch = policy.latestBatchId
          ? await ctx.db.get("importBatches", policy.latestBatchId)
          : null;
        const snapshot = await ctx.db
          .query("holdingSnapshots")
          .withIndex("by_householdId_and_positionKey_and_date", (q) =>
            q
              .eq("householdId", household._id)
              .eq(
                "positionKey",
                policy.importedPositionKey ?? policyPositionKey(policy._id),
              ),
          )
          .order("desc")
          .first();
        const row = snapshot ? decodeFact(snapshot.factJson).row : null;
        const draft = batch ? parseRows(batch.previewRowsJson)[0] : null;

        return {
          id: policy.importedPositionKey ?? policy._id,
          canEditNames: !policy.importedPositionKey,
          provider: policy.provider,
          name: policy.name,
          values:
            row?.kind === "holding" && snapshot
              ? {
                  investedAmount: row.investedAmount,
                  currentValue: row.currentValue,
                  sourceDate: snapshot.date,
                }
              : null,
          draftValues:
            draft?.kind === "holding" && draft.sourceDate
              ? {
                  investedAmount: draft.investedAmount,
                  currentValue: draft.currentValue,
                  sourceDate: draft.sourceDate,
                }
              : null,
          entry: batch ? await batchToView(ctx, batch) : null,
        };
      }),
    );
    const activeVersionId = household.activePortfolioVersionId;
    const imported = activeVersionId
      ? await ctx.db
          .query("portfolioPositions")
          .withIndex("by_versionId_and_assetClass", (q) =>
            q.eq("versionId", activeVersionId).eq("assetClass", "ulip"),
          )
          .take(policyLimit + 1)
      : [];
    const linked = new Set(
      policies.map((policy) => policy.importedPositionKey),
    );
    const available = imported.filter(
      (position) =>
        position.status === "current" && !linked.has(position.positionKey),
    );
    const entries = await Promise.all(
      available.map(async (position) => {
        const row = decodeFact(position.holdingJson).row;

        if (row.kind !== "holding" || row.policyId || row.currency !== "INR")
          return null;

        const snapshot = await importedSnapshot(
          ctx,
          household._id,
          position.positionKey,
        );
        const batch = snapshot?.batchId
          ? await ctx.db.get("importBatches", snapshot.batchId)
          : null;

        if (!snapshot || !batch) return null;

        return {
          id: position.positionKey,
          canEditNames: false,
          provider: row.provider,
          name: row.instrumentName,
          values: {
            investedAmount: row.investedAmount,
            currentValue: row.currentValue,
            sourceDate: snapshot.date,
          },
          draftValues: null,
          entry: await batchToView(ctx, batch),
        };
      }),
    );

    return [...manual, ...entries.filter((entry) => entry !== null)];
  },
});

async function importedSnapshot(
  ctx: QueryCtx,
  householdId: Id<"households">,
  positionKey: string,
) {
  return ctx.db
    .query("holdingSnapshots")
    .withIndex("by_householdId_and_positionKey_and_date", (q) =>
      q.eq("householdId", householdId).eq("positionKey", positionKey),
    )
    .order("desc")
    .first();
}

export const create = mutation({
  args: {
    provider: v.string(),
    name: v.string(),
    ...valuesValidator.fields,
    requestId: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) =>
    withMutationDiagnostics("manualPolicies.create", args, async () => {
      requireApplicationWritesEnabled();
      const { user, household } = await requireOwner(ctx);

      const input = validate(manualPolicyInputSchema, args);
      validateSnapshotDate(input.sourceDate);

      const inputHash = digest(JSON.stringify(input));
      const replay = await replayRequest(
        ctx,
        household._id,
        args.requestId,
        inputHash,
      );

      if (replay) return replay;

      const policies = await ctx.db
        .query("manualPolicies")
        .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
        .take(policyLimit);

      if (policies.length >= policyLimit) {
        throw new ConvexError({
          code: "CAPACITY",
          message: "A household can track up to 64 manual policies.",
        });
      }

      const policyId = await ctx.db.insert("manualPolicies", {
        householdId: household._id,
        provider: input.provider,
        name: input.name,
        createdAt: Date.now(),
      });
      const policy = await ctx.db.get("manualPolicies", policyId);

      if (!policy) throw new Error("New policy was not found");

      return saveSnapshot(
        ctx,
        policy,
        user._id,
        input,
        args.requestId,
        inputHash,
      );
    }),
});

export const updateValue = mutation({
  args: {
    policyId: v.string(),
    expectedBatchId: v.id("importBatches"),
    provider: v.string(),
    name: v.string(),
    ...valuesValidator.fields,
    requestId: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) =>
    withMutationDiagnostics("manualPolicies.updateValue", args, async () => {
      requireApplicationWritesEnabled();
      const { user, household } = await requireOwner(ctx);

      const manualId = ctx.db.normalizeId("manualPolicies", args.policyId);
      let policy = manualId
        ? await ctx.db.get("manualPolicies", manualId)
        : await ctx.db
            .query("manualPolicies")
            .withIndex("by_householdId_and_importedPositionKey", (q) =>
              q
                .eq("householdId", household._id)
                .eq("importedPositionKey", args.policyId),
            )
            .unique();

      const activeVersionId = household.activePortfolioVersionId;

      if (!policy && !manualId && activeVersionId) {
        const position = await ctx.db
          .query("portfolioPositions")
          .withIndex("by_versionId_and_positionKey", (q) =>
            q.eq("versionId", activeVersionId).eq("positionKey", args.policyId),
          )
          .unique();
        const snapshot = position
          ? await importedSnapshot(ctx, household._id, args.policyId)
          : null;
        const row = snapshot ? decodeFact(snapshot.factJson).row : null;

        if (
          position?.status === "current" &&
          row?.kind === "holding" &&
          row.assetClass === "ulip" &&
          row.currency === "INR" &&
          !row.policyId
        ) {
          const existing = await ctx.db
            .query("manualPolicies")
            .withIndex("by_householdId", (q) =>
              q.eq("householdId", household._id),
            )
            .take(policyLimit);

          if (existing.length >= policyLimit)
            throw new ConvexError({
              code: "CAPACITY",
              message: "A household can track up to 64 manual policies.",
            });

          const policyId = await ctx.db.insert("manualPolicies", {
            householdId: household._id,
            provider: row.provider,
            name: row.instrumentName,
            importedPositionKey: args.policyId,
            latestBatchId: snapshot?.batchId,
            createdAt: Date.now(),
          });
          policy = await ctx.db.get("manualPolicies", policyId);
        }
      }

      if (!policy || policy.householdId !== household._id) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Policy not found.",
        });
      }

      const values = validate(manualPolicyInputSchema, args);
      validateSnapshotDate(values.sourceDate);

      if (
        policy.importedPositionKey &&
        (values.provider !== policy.provider || values.name !== policy.name)
      ) {
        throw new ConvexError({
          code: "VALIDATION",
          message:
            "Imported policy names and providers must be changed in the source workbook.",
        });
      }

      const inputHash = digest(
        JSON.stringify({ policyId: policy._id, ...values }),
      );
      const replay = await replayRequest(
        ctx,
        household._id,
        args.requestId,
        inputHash,
      );

      if (replay) return replay;

      if (policy.latestBatchId !== args.expectedBatchId) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This policy has changed. Reload it before saving.",
        });
      }

      const previous = await ctx.db.get("importBatches", args.expectedBatchId);

      if (previous?.status === "publishing") {
        throw new ConvexError({
          code: "CONFLICT",
          message: "The previous value is still saving. Wait for it to finish.",
        });
      }

      await ctx.db.patch("manualPolicies", policy._id, {
        provider: values.provider,
        name: values.name,
      });

      return saveSnapshot(
        ctx,
        { ...policy, provider: values.provider, name: values.name },
        user._id,
        values,
        args.requestId,
        inputHash,
      );
    }),
});

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ConvexError({
      code: "VALIDATION",
      message: result.error.issues[0]?.message ?? "Check the entry values.",
    });
  }

  return result.data;
}

function validateSnapshotDate(date: string) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (date > today) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "The value date cannot be in the future.",
    });
  }
}

async function replayRequest(
  ctx: QueryCtx,
  householdId: Id<"households">,
  requestId: string,
  inputHash: string,
) {
  if (!z.string().uuid().safeParse(requestId).success) {
    throw new ConvexError({
      code: "VALIDATION",
      message: "Invalid entry request.",
    });
  }

  const existing = await ctx.db
    .query("importBatches")
    .withIndex("by_householdId_and_manualRequestId", (q) =>
      q.eq("householdId", householdId).eq("manualRequestId", requestId),
    )
    .unique();

  if (!existing) return null;

  if (!existing.manualPolicyId || existing.manualInputHash !== inputHash) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "This request was already used for a different entry.",
    });
  }

  const policy = await ctx.db.get("manualPolicies", existing.manualPolicyId);

  return {
    policyId: policy?.importedPositionKey ?? existing.manualPolicyId,
    batchId: existing._id,
  };
}

async function saveSnapshot(
  ctx: MutationCtx,
  policy: Doc<"manualPolicies">,
  uploaderId: Id<"users">,
  values: z.output<typeof manualPolicyValuesSchema>,
  requestId: string,
  inputHash: string,
) {
  const pnlAmount = canonicalizeDecimal(
    new FinancialDecimal(values.currentValue)
      .minus(values.investedAmount)
      .toFixed(),
  );

  const snapshot = policy.importedPositionKey
    ? await importedSnapshot(
        ctx,
        policy.householdId,
        policy.importedPositionKey,
      )
    : null;
  const original = snapshot ? decodeFact(snapshot.factJson).row : null;

  if (policy.importedPositionKey && original?.kind !== "holding")
    throw new Error("Imported policy snapshot is missing");

  const row = exactNormalizedHoldingRowSchema.parse({
    kind: "holding",
    sourceType: "manual_snapshot",
    policyId: policy._id,
    accountName: policy.provider,
    provider: policy.provider,
    instrumentName: policy.name,
    assetClass: "ulip",
    currency: "INR",
    ...values,
    pnlAmount,
    pnlPercent:
      values.investedAmount === "0"
        ? undefined
        : new FinancialDecimal(pnlAmount)
            .div(values.investedAmount)
            .times(100)
            .toNumber(),
    source: {
      group: `manual-policy:${policy._id}`,
      completeness: "partial",
      granularity: "instrument",
      priority: 0,
    },
    numericProvenance: {
      investedAmount: "source_decimal",
      currentValue: "source_decimal",
      pnlAmount: "derived_decimal",
    },
    metadata: {},
    // Keep the workbook identity. Assigning a new policyId would duplicate
    // the imported holding and separate it from its existing history.
    ...(original?.kind === "holding"
      ? {
          policyId: undefined,
          accountName: original.accountName,
          provider: original.provider,
          instrumentName: original.instrumentName,
          symbol: original.symbol,
          source: { ...original.source, completeness: "partial" },
          metadata: { ...original.metadata, manualPolicyUpdate: true },
        }
      : {}),
  });

  const rowsJson = JSON.stringify([row]);
  const bytes = utf8Bytes(rowsJson);
  const checksum = digest(rowsJson);
  const now = Date.now();

  const batchId = await ctx.db.insert("importBatches", {
    householdId: policy.householdId,
    uploaderId,
    manualPolicyId: policy._id,
    manualRequestId: requestId,
    manualInputHash: inputHash,
    fileName: policy.name,
    sizeBytes: 0,
    status: "parsed",
    attempt: 1,
    createdAt: now,
    processedAt: now,
    rowCount: 1,
    normalizedBytes: bytes,
    previewRowsJson: rowsJson,
    warnings: [],
    contentHash: digest(`${requestId}:${rowsJson}`),
    parserVersion: "manual-policy-v1",
    sourceType: "manual_snapshot",
    manifest: [{ index: 0, count: 1, bytes, digest: checksum }],
  });

  await ctx.db.insert("importRowChunks", {
    batchId,
    attempt: 1,
    index: 0,
    count: 1,
    bytes,
    digest: checksum,
    rowsJson,
  });

  await ctx.db.patch("manualPolicies", policy._id, { latestBatchId: batchId });

  const batch = await ctx.db.get("importBatches", batchId);

  if (!batch) throw new Error("New entry was not found");

  await commitBatch(ctx, batch);

  return { policyId: policy.importedPositionKey ?? policy._id, batchId };
}
