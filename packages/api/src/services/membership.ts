import { and, eq } from "drizzle-orm";
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
    .limit(1);

  if (existing[0]) {
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
