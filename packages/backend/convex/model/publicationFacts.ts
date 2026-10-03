import type { IdentifiedFact } from "@investment-sync/portfolio-domain";
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { capacityError, checkedJson, portfolioLimits } from "./portfolioLimits";

type AccountWrite = WithoutSystemFields<Doc<"accounts">>;
type InstrumentWrite = WithoutSystemFields<Doc<"instruments">>;
type ImmutableFactWrite =
  | {
      table: "holdingSnapshots";
      value: WithoutSystemFields<Doc<"holdingSnapshots">>;
    }
  | { table: "transactions"; value: WithoutSystemFields<Doc<"transactions">> }
  | {
      table: "portfolioValuations";
      value: WithoutSystemFields<Doc<"portfolioValuations">>;
    };

export async function ensureAccount(ctx: MutationCtx, value: AccountWrite) {
  if (
    value.key !==
    JSON.stringify([
      value.provider.trim().toLowerCase(),
      value.name.trim().toLowerCase(),
    ])
  )
    throw new Error("Account logical key does not match identity");
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", value.householdId).eq("key", value.key),
    )
    .unique();
  if (existing) {
    if (
      existing.provider.trim().toLowerCase() !==
        value.provider.trim().toLowerCase() ||
      existing.name.trim().toLowerCase() !== value.name.trim().toLowerCase()
    )
      throw new Error("Conflicting account identity");

    // Legacy imports retain the first account currency/type for a shared name.
    return existing._id;
  }

  return ctx.db.insert("accounts", value);
}

export async function ensureInstrument(
  ctx: MutationCtx,
  value: InstrumentWrite,
) {
  const symbol = value.symbol?.trim().toUpperCase();
  if (
    value.key !==
    JSON.stringify([
      value.assetClass,
      value.currency,
      symbol ? "symbol" : "name",
      symbol || value.name.trim().toLowerCase(),
    ])
  )
    throw new Error("Instrument logical key does not match identity");

  const existing = await ctx.db
    .query("instruments")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", value.householdId).eq("key", value.key),
    )
    .unique();
  if (existing) {
    if (
      existing.assetClass !== value.assetClass ||
      existing.currency !== value.currency ||
      existing.symbol?.trim().toUpperCase() !== symbol ||
      (!symbol &&
        existing.name.trim().toLowerCase() !== value.name.trim().toLowerCase())
    )
      throw new Error("Conflicting instrument identity");

    // A symbol identifies an instrument independently of later display-name changes.
    return existing._id;
  }

  return ctx.db.insert("instruments", value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  return value;
}

function equalFactJson(left: string, right: string) {
  if (left === right) return true;
  const parsedLeft: unknown = JSON.parse(left);
  const parsedRight: unknown = JSON.parse(right);
  return (
    JSON.stringify(canonicalValue(parsedLeft)) ===
    JSON.stringify(canonicalValue(parsedRight))
  );
}

export async function ensureImmutableFact(
  ctx: MutationCtx,
  input: ImmutableFactWrite,
) {
  const value = input.value;
  const existing = await ctx.db
    .query(input.table)
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", value.householdId).eq("key", value.key),
    )
    .unique();
  if (existing) {
    const storedFields = new Map(Object.entries(existing));
    for (const [field, expected] of Object.entries(value)) {
      const stored = storedFields.get(field);
      const matches =
        field === "factJson" &&
        typeof stored === "string" &&
        typeof expected === "string"
          ? equalFactJson(stored, expected)
          : stored === expected;
      if (!matches) throw new Error("Conflicting immutable portfolio fact");
    }
    return existing._id;
  }

  switch (input.table) {
    case "holdingSnapshots":
      return ctx.db.insert(input.table, input.value);
    case "transactions":
      return ctx.db.insert(input.table, input.value);
    case "portfolioValuations":
      return ctx.db.insert(input.table, input.value);
  }
}

export async function persistIdentities(
  ctx: MutationCtx,
  householdId: Id<"households">,
  facts: IdentifiedFact[],
) {
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", householdId),
    )
    .take(portfolioLimits.accounts + 1);
  const instruments = await ctx.db
    .query("instruments")
    .withIndex("by_householdId_and_key", (q) =>
      q.eq("householdId", householdId),
    )
    .take(portfolioLimits.instruments + 1);
  if (
    accounts.length > portfolioLimits.accounts ||
    instruments.length > portfolioLimits.instruments
  )
    capacityError("Household identity capacity exceeded");
  const accountKeys = new Set(accounts.map((account) => account.key));
  const instrumentKeys = new Set(
    instruments.map((instrument) => instrument.key),
  );
  if (
    accountKeys.size !== accounts.length ||
    instrumentKeys.size !== instruments.length
  )
    throw new Error("Duplicate stored portfolio identity");

  const pendingAccounts = new Map<string, AccountWrite>();
  const pendingInstruments = new Map<string, InstrumentWrite>();
  for (const { identity, row } of facts) {
    if (identity.kind === "valuation" || row.kind === "valuation") continue;
    if (!pendingAccounts.has(identity.accountKey))
      pendingAccounts.set(identity.accountKey, {
        householdId,
        key: identity.accountKey,
        provider: row.provider.trim(),
        name: row.accountName.trim(),
        accountType: row.assetClass,
        currency: row.currency,
      });
    if (!pendingInstruments.has(identity.instrumentKey))
      pendingInstruments.set(identity.instrumentKey, {
        householdId,
        key: identity.instrumentKey,
        name: row.instrumentName.trim(),
        symbol: row.symbol?.trim() || undefined,
        assetClass: row.assetClass,
        currency: row.currency,
      });
  }

  for (const value of pendingAccounts.values()) {
    if (
      !accountKeys.has(value.key) &&
      accountKeys.size >= portfolioLimits.accounts
    )
      capacityError("Household account capacity exceeded");
    await ensureAccount(ctx, value);
    accountKeys.add(value.key);
  }
  for (const value of pendingInstruments.values()) {
    if (
      !instrumentKeys.has(value.key) &&
      instrumentKeys.size >= portfolioLimits.instruments
    )
      capacityError("Household instrument capacity exceeded");
    await ensureInstrument(ctx, value);
    instrumentKeys.add(value.key);
  }
}

export async function persistFacts(
  ctx: MutationCtx,
  batch: Doc<"importBatches">,
  facts: IdentifiedFact[],
) {
  for (const fact of facts) {
    const common = {
      householdId: batch.householdId,
      batchId: batch._id,
      key: JSON.stringify([fact.provenance.batchId, fact.provenance.rowNumber]),
      factJson: checkedJson({ row: fact.row, provenance: fact.provenance }),
    };
    const identity = fact.identity;
    if (identity.kind === "holding") {
      await ensureImmutableFact(ctx, {
        table: "holdingSnapshots",
        value: {
          ...common,
          positionKey: identity.positionKey,
          instrumentKey: identity.instrumentKey,
          sourceGroupKey: identity.sourceGroupKey,
          date: identity.snapshotDate,
        },
      });
      if (fact.provenance.legacyId) {
        const legacyId = fact.provenance.legacyId;
        const existing = await ctx.db
          .query("legacyHoldingAliases")
          .withIndex("by_householdId_and_legacyId", (q) =>
            q.eq("householdId", batch.householdId).eq("legacyId", legacyId),
          )
          .unique();
        if (existing && existing.positionKey !== identity.positionKey)
          throw new Error("Conflicting legacy holding alias");
        if (!existing)
          await ctx.db.insert("legacyHoldingAliases", {
            householdId: batch.householdId,
            legacyId,
            positionKey: identity.positionKey,
          });
      }
    } else if (
      identity.kind === "transaction" &&
      fact.row.kind === "transaction"
    ) {
      await ensureImmutableFact(ctx, {
        table: "transactions",
        value: {
          ...common,
          positionKey: identity.positionKey,
          instrumentKey: identity.instrumentKey,
          occurrenceKey: identity.occurrenceKey,
          date: fact.row.tradeDate,
        },
      });
    } else if (identity.kind === "valuation" && fact.row.kind === "valuation") {
      await ensureImmutableFact(ctx, {
        table: "portfolioValuations",
        value: {
          ...common,
          date: fact.row.valuationDate,
        },
      });
    } else {
      throw new Error("Publication fact identity mismatch");
    }
  }
}
