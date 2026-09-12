import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { findUserByClerkSubject, requireUserMembership } from "./users";

export async function requireIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }

  return identity;
}

export async function requireCurrentMembership(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await findUserByClerkSubject(ctx, identity.subject);

  if (!user) {
    throw new ConvexError({ code: "USER_NOT_PROVISIONED" });
  }

  const { membership, household } = await requireUserMembership(ctx, user);

  return { identity, user, membership, household };
}

export async function requireOwner(ctx: QueryCtx) {
  const current = await requireCurrentMembership(ctx);

  if (current.membership.role !== "owner") {
    throw new ConvexError({ code: "NOT_FOUND" });
  }

  return current;
}
