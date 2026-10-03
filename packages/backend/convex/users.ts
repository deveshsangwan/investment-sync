import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentMembership, requireIdentity } from "./model/auth";
import { ensureUserProvisioned } from "./model/users";
import { hasMigrationWriteFreeze } from "./model/migrationFreeze";

export const ensureCurrent = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    if (hasMigrationWriteFreeze()) {
      const { user } = await requireCurrentMembership(ctx);

      return user._id;
    }

    const identity = await requireIdentity(ctx);

    return ensureUserProvisioned(ctx, {
      clerkSubject: identity.subject,
      email: identity.email,
    });
  },
});

export const current = query({
  args: {},
  returns: v.object({
    id: v.id("users"),
    email: v.optional(v.string()),
    householdId: v.id("households"),
    householdName: v.string(),
    role: v.union(v.literal("owner"), v.literal("viewer")),
  }),
  handler: async (ctx) => {
    const { user, membership, household } = await requireCurrentMembership(ctx);

    return {
      id: user._id,
      email: user.email,
      householdId: membership.householdId,
      householdName: household.name,
      role: membership.role,
    };
  },
});
