import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireCurrentMembership } from "./model/auth";
import { capacityError, portfolioLimits } from "./model/portfolioLimits";
import { accountViewValidator } from "./model/portfolioValidators";

export const list = query({
  args: {},
  returns: v.array(accountViewValidator),
  handler: async (ctx) => {
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
      .map((account) => ({
        id: account.key,
        name: account.name,
        provider: account.provider,
        accountType: account.accountType,
        currency: account.currency,
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.provider.localeCompare(right.provider),
      );
  },
});
