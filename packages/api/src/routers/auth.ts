import { households, users } from "@investment-sync/db";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";

export const authRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const [profile] = await ctx.db
      .select({
        id: users.id,
        clerkUserId: users.clerkUserId,
        email: users.email,
        householdId: households.id,
        householdName: households.name,
      })
      .from(users)
      .innerJoin(households, eq(households.ownerUserId, users.id))
      .where(eq(users.id, ctx.membership.appUserId))
      .limit(1);

    return {
      user: profile,
      permissions: {
        canUpload: ctx.membership.role === "owner",
        canManageHousehold: ctx.membership.role === "owner",
      },
    };
  }),
});
