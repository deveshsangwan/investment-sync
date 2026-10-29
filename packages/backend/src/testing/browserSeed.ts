import { v } from "convex/values";
import { internalMutation } from "../../convex/_generated/server";
import { ensureUserProvisioned } from "../../convex/model/users";

export const seed = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.APP_ENV !== "test") {
      throw new Error("Browser fixtures require an isolated test backend");
    }

    const ownerId = await ensureUserProvisioned(ctx, {
      clerkSubject: "e2e_owner",
      email: "owner@example.invalid",
    });
    const membership = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q) => q.eq("userId", ownerId))
      .unique();

    if (!membership) throw new Error("Test owner was not provisioned");

    const viewerId = await ctx.db.insert("users", {
      clerkSubject: "e2e_viewer",
      email: "viewer@example.invalid",
    });
    await ctx.db.insert("householdMembers", {
      householdId: membership.householdId,
      userId: viewerId,
      role: "viewer",
    });

    return null;
  },
});
