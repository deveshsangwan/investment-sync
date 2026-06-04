import { and, asc, eq } from "drizzle-orm";
import {
  accounts,
  householdMembers,
  households,
  users,
} from "@investment-sync/db";
import type { ApiContext } from "../context";

export interface MembershipContext {
  userId: string;
  appUserId: string;
  householdId: string;
  role: string;
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
    console.log("membership cache hit");
    return existing.promise;
  }

  console.log("membership cache miss");

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

async function loadMembership(ctx: ApiContext): Promise<MembershipContext> {
  const clerkUserId = ctx.auth.userId;
  if (!clerkUserId) throw new Error("Missing Clerk user id");

  const existing = await ctx.db
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

  if (existing[0]) {
    if (ctx.auth.email) {
      await ctx.db
        .update(users)
        .set({ email: ctx.auth.email, updatedAt: new Date() })
        .where(eq(users.id, existing[0].appUserId));
    }

    return {
      userId: clerkUserId,
      appUserId: existing[0].appUserId,
      householdId: existing[0].householdId,
      role: existing[0].role,
    };
  }

  const [createdUser] = await ctx.db
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

  const [createdHousehold] = await ctx.db
    .insert(households)
    .values({
      name: "My Portfolio",
      ownerUserId: createdUser.id,
    })
    .returning();

  if (!createdHousehold) throw new Error("Failed to create household");

  await ctx.db.insert(householdMembers).values({
    householdId: createdHousehold.id,
    userId: createdUser.id,
    role: "owner",
  });

  await ctx.db.insert(accounts).values(
    defaultAccounts.map((account) => ({
      householdId: createdHousehold.id,
      ...account,
    })),
  );

  const membership = await ctx.db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, createdHousehold.id),
        eq(householdMembers.userId, createdUser.id),
      ),
    )
    .limit(1);

  return {
    userId: clerkUserId,
    appUserId: createdUser.id,
    householdId: createdHousehold.id,
    role: membership[0]?.role ?? "owner",
  };
}
