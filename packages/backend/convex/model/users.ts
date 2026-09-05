import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type UserProfile = {
  clerkSubject: string;
  email?: string;
};

export async function findUserByClerkSubject(
  ctx: QueryCtx,
  clerkSubject: string,
) {
  const matchingUsers = await ctx.db
    .query("users")
    .withIndex("by_clerk_subject", (query) =>
      query.eq("clerkSubject", clerkSubject),
    )
    .take(2);

  if (matchingUsers.length > 1) {
    throw new ConvexError({ code: "IDENTITY_CONFLICT" });
  }

  return matchingUsers[0] ?? null;
}

export async function requireUserMembership(ctx: QueryCtx, user: Doc<"users">) {
  const memberships = await ctx.db
    .query("householdMembers")
    .withIndex("by_user", (query) => query.eq("userId", user._id))
    .take(2);
  const membership = memberships[0];

  if (!membership || memberships.length !== 1) {
    throw new ConvexError({ code: "INVALID_MEMBERSHIP" });
  }

  const household = await ctx.db.get("households", membership.householdId);

  if (
    !household ||
    (membership.role === "owner" && household.ownerUserId !== user._id)
  ) {
    throw new ConvexError({ code: "INVALID_MEMBERSHIP" });
  }

  return { membership, household };
}

export async function ensureUserProvisioned(
  ctx: MutationCtx,
  profile: UserProfile,
) {
  const existingUser = await findUserByClerkSubject(ctx, profile.clerkSubject);

  if (existingUser) {
    // Normal provisioning is atomic. Incomplete existing data needs explicit
    // repair; creating another Household could hide the original portfolio.
    await requireUserMembership(ctx, existingUser);

    // An omitted Clerk claim is not a request to erase the saved profile.
    if (profile.email && existingUser.email !== profile.email) {
      await ctx.db.patch("users", existingUser._id, { email: profile.email });
    }

    return existingUser._id;
  }

  const userId = await ctx.db.insert("users", profile);
  const householdId = await ctx.db.insert("households", {
    ownerUserId: userId,
    name: "My Portfolio",
  });
  await ctx.db.insert("householdMembers", {
    householdId,
    userId,
    role: "owner",
  });

  return userId;
}
