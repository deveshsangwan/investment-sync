import { mutation, query } from "./_generated/server";
import { requireCurrentMembership, requireIdentity } from "./model/auth";
import { ensureUserProvisioned } from "./model/users";

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    return ensureUserProvisioned(ctx, {
      clerkSubject: identity.subject,
      email: identity.email,
    });
  },
});

export const current = query({
  args: {},
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
