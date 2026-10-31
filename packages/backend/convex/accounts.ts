import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCurrentMembership, requireOwner } from "./model/auth";
import { capacityError, portfolioLimits } from "./model/portfolioLimits";
import { requireApplicationWritesEnabled } from "./model/migrationFreeze";
import { accountViewValidator } from "./model/portfolioValidators";

async function listAccounts(ctx: QueryCtx, includeArchived: boolean) {
  const { household } = await requireCurrentMembership(ctx);
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_householdId_and_key", (index) =>
      index.eq("householdId", household._id),
    )
    .take(portfolioLimits.accounts + 1);
  if (accounts.length > portfolioLimits.accounts)
    capacityError("Household account capacity exceeded");

  return accounts
    .filter((account) => includeArchived || !account.isArchived)
    .map((account) => ({
      id: account.key,
      name: account.displayName ?? account.name,
      isArchived: account.isArchived ?? false,
      provider: account.provider,
      accountType: account.accountType,
      currency: account.currency,
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.provider.localeCompare(right.provider),
    );
}

export const list = query({
  args: {},
  returns: v.array(accountViewValidator),
  handler: (ctx) => listAccounts(ctx, false),
});

export const listAll = query({
  args: {},
  returns: v.array(accountViewValidator),
  handler: (ctx) => listAccounts(ctx, true),
});

export const update = mutation({
  args: {
    accountKey: v.string(),
    name: v.optional(v.string()),
    isArchived: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { household } = await requireOwner(ctx);
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_householdId_and_key", (q) =>
        q.eq("householdId", household._id).eq("key", args.accountKey),
      )
      .unique();
    if (!account) throw new ConvexError({ code: "NOT_FOUND" });

    const displayName = args.name?.trim();
    if (
      displayName !== undefined &&
      (displayName.length === 0 || displayName.length > 120)
    )
      throw new ConvexError("Account name must contain 1 to 120 characters");

    await ctx.db.patch("accounts", account._id, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(args.isArchived !== undefined ? { isArchived: args.isArchived } : {}),
    });
    return null;
  },
});
