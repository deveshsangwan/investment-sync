import { asc, eq } from "drizzle-orm";
import {
  accounts,
  householdMembers,
  households,
  users,
} from "@investment-sync/db";
import type { ApiContext } from "../context";
import { logger } from "../logger";

export interface MembershipContext {
  userId: string;
  appUserId: string;
  householdId: string;
  role: string;
}

/**
 * Server-side permission check. `auth.me` exposes the same rule to clients as a
 * display flag; mutations must call this instead of trusting that flag.
 */
export function canManageHousehold(membership: MembershipContext): boolean {
  return membership.role === "owner";
}

const MEMBERSHIP_CACHE_TTL_MS = 30_000;

interface CachedMembership {
  expiresAt: number;
  promise: Promise<MembershipContext>;
}

const membershipCache = new Map<string, CachedMembership>();

const defaultAccounts = [
  {
    name: "Indian Stocks",
    provider: "Tickertape",
    accountType: "broker",
    currency: "INR" as const,
  },
  {
    name: "Mutual Funds",
    provider: "Tickertape",
    accountType: "mutual_fund",
    currency: "INR" as const,
  },
  {
    name: "US Stocks",
    provider: "Vested / DriveWealth",
    accountType: "broker",
    currency: "USD" as const,
  },
  {
    name: "NPS",
    provider: "Manual",
    accountType: "retirement",
    currency: "INR" as const,
  },
  {
    name: "ULIPs",
    provider: "Manual",
    accountType: "insurance",
    currency: "INR" as const,
  },
  {
    name: "Crypto",
    provider: "Manual",
    accountType: "crypto",
    currency: "INR" as const,
  },
];

export async function ensureMembership(
  ctx: ApiContext,
): Promise<MembershipContext> {
  const cached = ctx.cache.get("membership");
  if (cached) return cached as Promise<MembershipContext>;

  const clerkUserId = ctx.auth.userId;
  if (!clerkUserId) throw new Error("Missing Clerk user id");

  const membership = cachedMembership(clerkUserId, () => loadMembership(ctx));
  ctx.cache.set("membership", membership);
  return membership;
}

function cachedMembership(
  clerkUserId: string,
  load: () => Promise<MembershipContext>,
): Promise<MembershipContext> {
  const now = Date.now();
  const existing = membershipCache.get(clerkUserId);

  if (existing && existing.expiresAt > now) {
    logger.debug("membership cache hit");
    return existing.promise;
  }

  logger.debug("membership cache miss");

  const promise = load().catch((error) => {
    const latest = membershipCache.get(clerkUserId);
    if (latest?.promise === promise) {
      membershipCache.delete(clerkUserId);
    }
    throw error;
  });

  membershipCache.set(clerkUserId, {
    expiresAt: now + MEMBERSHIP_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

async function selectMembership(
  db: ApiContext["db"],
  clerkUserId: string,
): Promise<MembershipContext | null> {
  const [existing] = await db
    .select({
      appUserId: users.id,
      householdId: householdMembers.householdId,
      role: householdMembers.role,
    })
    .from(users)
    .innerJoin(householdMembers, eq(users.id, householdMembers.userId))
    .where(eq(users.clerkUserId, clerkUserId))
    .orderBy(asc(householdMembers.createdAt))
    .limit(1);

  if (!existing) return null;

  return {
    userId: clerkUserId,
    appUserId: existing.appUserId,
    householdId: existing.householdId,
    role: existing.role,
  };
}

async function loadMembership(ctx: ApiContext): Promise<MembershipContext> {
  const clerkUserId = ctx.auth.userId;
  if (!clerkUserId) throw new Error("Missing Clerk user id");

  const existing = await selectMembership(ctx.db, clerkUserId);

  if (existing) {
    if (ctx.auth.email) {
      await ctx.db
        .update(users)
        .set({ email: ctx.auth.email, updatedAt: new Date() })
        .where(eq(users.id, existing.appUserId));
    }

    return existing;
  }

  try {
    return await ctx.db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          clerkUserId,
          email: ctx.auth.email,
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { email: ctx.auth.email },
        })
        .returning();

      if (!createdUser) throw new Error("Failed to create user");

      // Unique on owner_user_id: a concurrent first login raises here and the
      // whole provisioning rolls back instead of creating a second household.
      const [createdHousehold] = await tx
        .insert(households)
        .values({
          name: "My Portfolio",
          ownerUserId: createdUser.id,
        })
        .returning();

      if (!createdHousehold) throw new Error("Failed to create household");

      const [createdMember] = await tx
        .insert(householdMembers)
        .values({
          householdId: createdHousehold.id,
          userId: createdUser.id,
          role: "owner",
        })
        .returning({ role: householdMembers.role });

      await tx.insert(accounts).values(
        defaultAccounts.map((account) => ({
          householdId: createdHousehold.id,
          ...account,
        })),
      );

      return {
        userId: clerkUserId,
        appUserId: createdUser.id,
        householdId: createdHousehold.id,
        role: createdMember?.role ?? "owner",
      };
    });
  } catch (error) {
    // Another request provisioned this user first; reuse what it committed.
    const raced = await selectMembership(ctx.db, clerkUserId);
    if (raced) return raced;
    throw error;
  }
}
