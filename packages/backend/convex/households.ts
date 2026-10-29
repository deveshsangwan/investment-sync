import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireCurrentMembership, requireOwner } from "./model/auth";
import { requireApplicationWritesEnabled } from "./model/migrationFreeze";
import { digest } from "./model/importLimits";

const roleValidator = v.union(v.literal("owner"), v.literal("viewer"));
const invalidInvite = () =>
  new ConvexError({
    code: "INVALID_INVITE",
    message:
      "This invitation is unavailable. Check your verified sign-in email or ask the owner for a new link.",
  });

async function audit(
  ctx: MutationCtx,
  householdId: Id<"households">,
  actorUserId: Id<"users">,
  action: string,
  target: string,
) {
  await ctx.db.insert("householdAuditEvents", {
    householdId,
    actorUserId,
    action,
    target,
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("households"),
      name: v.string(),
      role: roleValidator,
      isCurrent: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const { user, household } = await requireCurrentMembership(ctx);
    const memberships = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(33);
    if (memberships.length > 32)
      throw new ConvexError("Household membership capacity exceeded");

    return Promise.all(
      memberships.map(async (entry) => {
        const memberHousehold = await ctx.db.get(
          "households",
          entry.householdId,
        );
        if (!memberHousehold) throw new ConvexError("Invalid membership");

        return {
          id: memberHousehold._id,
          name: memberHousehold.name,
          role: entry.role,
          isCurrent: memberHousehold._id === household._id,
        };
      }),
    );
  },
});

export const select = mutation({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user } = await requireCurrentMembership(ctx);
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdId", args.householdId).eq("userId", user._id),
      )
      .unique();
    if (!member) throw new ConvexError({ code: "NOT_FOUND" });

    await ctx.db.patch("users", user._id, {
      currentHouseholdId: member.householdId,
    });
    return null;
  },
});

export const members = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("householdMembers"),
      userId: v.id("users"),
      email: v.union(v.string(), v.null()),
      role: roleValidator,
    }),
  ),
  handler: async (ctx) => {
    const { household } = await requireCurrentMembership(ctx);
    const members = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) => q.eq("householdId", household._id))
      .take(33);
    if (members.length > 32)
      throw new ConvexError("Household member capacity exceeded");

    return Promise.all(
      members.map(async (member) => ({
        id: member._id,
        userId: member.userId,
        role: member.role,
        email: (await ctx.db.get("users", member.userId))?.email ?? null,
      })),
    );
  },
});

export const pendingInvites = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("householdInvites"),
      email: v.string(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const { household } = await requireOwner(ctx);
    const invites = await ctx.db
      .query("householdInvites")
      .withIndex("by_householdId_and_status", (q) =>
        q.eq("householdId", household._id).eq("status", "pending"),
      )
      .take(65);
    if (invites.length > 64)
      throw new ConvexError("Invitation capacity exceeded");

    return invites.map((invite) => ({
      id: invite._id,
      email: invite.email,
      expiresAt: invite.expiresAt,
    }));
  },
});

export const issueInvite = internalMutation({
  args: { email: v.string(), tokenHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user, household } = await requireOwner(ctx);
    const email = z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254)
      .parse(args.email);
    const pending = await ctx.db
      .query("householdInvites")
      .withIndex("by_householdId_and_status", (q) =>
        q.eq("householdId", household._id).eq("status", "pending"),
      )
      .take(65);
    // Reissuing invalidates older links for the same address, including expired ones.
    for (const invite of pending) {
      if (invite.email === email || invite.expiresAt <= Date.now())
        await ctx.db.patch("householdInvites", invite._id, {
          status: "revoked",
        });
    }
    if (
      pending.filter(
        (invite) => invite.email !== email && invite.expiresAt > Date.now(),
      ).length >= 64
    )
      throw new ConvexError("Invitation capacity exceeded");

    await ctx.db.insert("householdInvites", {
      householdId: household._id,
      email,
      tokenHash: args.tokenHash,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      status: "pending",
      createdBy: user._id,
    });
    await audit(ctx, household._id, user._id, "invite.created", email);
    return null;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("householdInvites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user, household } = await requireOwner(ctx);
    const invite = await ctx.db.get("householdInvites", args.inviteId);
    if (!invite || invite.householdId !== household._id)
      throw new ConvexError({ code: "NOT_FOUND" });

    if (invite.status === "pending") {
      await ctx.db.patch("householdInvites", invite._id, { status: "revoked" });
      await audit(ctx, household._id, user._id, "invite.revoked", invite.email);
    }
    return null;
  },
});

export const acceptInvite = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { identity, user } = await requireCurrentMembership(ctx);
    if (!/^[a-f0-9]{64}$/.test(args.token)) throw invalidInvite();

    if (!identity.email || identity.emailVerified === undefined)
      throw new ConvexError({
        code: "VERIFIED_EMAIL_UNAVAILABLE",
        message:
          "Your verified sign-in email is unavailable. Verify your email, then sign out and sign in. If this persists, contact the app administrator.",
      });

    const invite = await ctx.db
      .query("householdInvites")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", digest(args.token)))
      .unique();
    if (
      !invite ||
      invite.status !== "pending" ||
      invite.expiresAt <= Date.now() ||
      identity.emailVerified !== true ||
      identity.email?.trim().toLowerCase() !== invite.email
    )
      throw invalidInvite();

    const household = await ctx.db.get("households", invite.householdId);
    if (!household) throw invalidInvite();
    const memberships = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(33);
    const members = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) => q.eq("householdId", household._id))
      .take(33);
    const existing = memberships.find(
      (member) => member.householdId === household._id,
    );
    if (!existing && (memberships.length >= 32 || members.length >= 32))
      throw new ConvexError("Household member capacity exceeded");

    if (!existing)
      await ctx.db.insert("householdMembers", {
        householdId: household._id,
        userId: user._id,
        role: "viewer",
      });
    await ctx.db.patch("users", user._id, {
      currentHouseholdId: household._id,
      email: invite.email,
    });
    await ctx.db.patch("householdInvites", invite._id, { status: "accepted" });
    await audit(ctx, household._id, user._id, "invite.accepted", user._id);
    return null;
  },
});

export const removeMember = mutation({
  args: { memberId: v.id("householdMembers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user, household } = await requireOwner(ctx);
    const member = await ctx.db.get("householdMembers", args.memberId);
    if (!member || member.householdId !== household._id)
      throw new ConvexError({ code: "NOT_FOUND" });
    if (member.role === "owner" || member.userId === household.ownerUserId)
      throw new ConvexError("Transfer ownership before removing the owner");

    const removedUser = await ctx.db.get("users", member.userId);
    if (!removedUser) throw new ConvexError("Invalid membership");
    const remaining = await ctx.db
      .query("householdMembers")
      .withIndex("by_user", (q) => q.eq("userId", member.userId))
      .take(33);
    const fallback = remaining.find((entry) => entry._id !== member._id);
    let fallbackHouseholdId = fallback?.householdId;
    if (!fallbackHouseholdId) {
      fallbackHouseholdId = await ctx.db.insert("households", {
        ownerUserId: member.userId,
        name: "My Portfolio",
      });
      await ctx.db.insert("householdMembers", {
        householdId: fallbackHouseholdId,
        userId: member.userId,
        role: "owner",
      });
    }

    const pendingInvites = await ctx.db
      .query("householdInvites")
      .withIndex("by_householdId_and_status", (q) =>
        q.eq("householdId", household._id).eq("status", "pending"),
      )
      .take(65);
    for (const invite of pendingInvites) {
      if (invite.email === removedUser.email?.trim().toLowerCase())
        await ctx.db.patch("householdInvites", invite._id, {
          status: "revoked",
        });
    }

    await ctx.db.delete("householdMembers", member._id);
    if (
      !removedUser.currentHouseholdId ||
      removedUser.currentHouseholdId === household._id
    )
      await ctx.db.patch("users", member.userId, {
        currentHouseholdId: fallbackHouseholdId,
      });
    await audit(ctx, household._id, user._id, "member.removed", member.userId);
    return null;
  },
});

export const transferOwnership = mutation({
  args: { memberId: v.id("householdMembers"), confirm: v.literal("TRANSFER") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireApplicationWritesEnabled();
    const { user, household, membership } = await requireOwner(ctx);
    if (household.publishingVersionId)
      throw new ConvexError(
        "Wait for the current import to finish before transferring ownership",
      );

    const nextOwner = await ctx.db.get("householdMembers", args.memberId);
    if (
      !nextOwner ||
      nextOwner.householdId !== household._id ||
      nextOwner.role !== "viewer"
    )
      throw new ConvexError({ code: "NOT_FOUND" });

    await ctx.db.patch("householdMembers", membership._id, { role: "viewer" });
    await ctx.db.patch("householdMembers", nextOwner._id, { role: "owner" });
    await ctx.db.patch("households", household._id, {
      ownerUserId: nextOwner.userId,
    });
    // Outstanding invitations were authorized by the previous owner.
    const pending = await ctx.db
      .query("householdInvites")
      .withIndex("by_householdId_and_status", (q) =>
        q.eq("householdId", household._id).eq("status", "pending"),
      )
      .take(65);
    for (const invite of pending)
      await ctx.db.patch("householdInvites", invite._id, { status: "revoked" });
    await audit(
      ctx,
      household._id,
      user._id,
      "ownership.transferred",
      nextOwner.userId,
    );
    return null;
  },
});

export const auditEvents = query({
  args: {},
  returns: v.array(
    v.object({ action: v.string(), target: v.string(), createdAt: v.number() }),
  ),
  handler: async (ctx) => {
    const { household } = await requireOwner(ctx);
    const events = await ctx.db
      .query("householdAuditEvents")
      .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
      .order("desc")
      .take(50);
    return events.map(({ action, target, createdAt }) => ({
      action,
      target,
      createdAt,
    }));
  },
});
