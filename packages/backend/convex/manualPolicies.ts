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
  policyId: v.id("manualPolicies"),
  batchId: v.id("importBatches"),
});
const policyLimit = 64;

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("manualPolicies"),
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

    return Promise.all(
      policies.map(async (policy) => {
        const batch = policy.latestBatchId
          ? await ctx.db.get("importBatches", policy.latestBatchId)
          : null;
        const snapshot = await ctx.db
          .query("holdingSnapshots")
          .withIndex("by_householdId_and_positionKey_and_date", (q) =>
            q
              .eq("householdId", household._id)
              .eq("positionKey", policyPositionKey(policy._id)),
          )
          .order("desc")
          .first();
        const row = snapshot ? decodeFact(snapshot.factJson).row : null;
        const draft = batch ? parseRows(batch.previewRowsJson)[0] : null;

        return {
          id: policy._id,
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
  },
});

export const create = mutation({
  args: {
    provider: v.string(),
    name: v.string(),
    ...valuesValidator.fields,
    requestId: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
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
  },
});

export const updateValue = mutation({
  args: {
    policyId: v.id("manualPolicies"),
    expectedBatchId: v.id("importBatches"),
    provider: v.string(),
    name: v.string(),
    ...valuesValidator.fields,
    requestId: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user, household } = await requireOwner(ctx);

    const policy = await ctx.db.get("manualPolicies", args.policyId);

    if (!policy || policy.householdId !== household._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Policy not found.",
      });
    }

    const values = validate(manualPolicyInputSchema, args);
    validateSnapshotDate(values.sourceDate);

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
  },
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

  return { policyId: existing.manualPolicyId, batchId: existing._id };
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

  return { policyId: policy._id, batchId };
}
