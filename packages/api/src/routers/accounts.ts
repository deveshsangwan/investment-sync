import { accounts } from "@investment-sync/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const accountsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, ctx.membership.householdId),
          eq(accounts.isArchived, false),
        ),
      );
  }),
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        provider: z.string().min(1),
        accountType: z.string().min(1),
        currency: z.enum(["INR", "USD", "BTC", "ETH", "OTHER"]).default("INR"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(accounts)
        .values({
          householdId: ctx.membership.householdId,
          ...input,
        })
        .returning();

      return created;
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(accounts)
        .set({
          name: input.name,
          isArchived: input.isArchived,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accounts.id, input.id),
            eq(accounts.householdId, ctx.membership.householdId),
          ),
        )
        .returning();

      return updated;
    }),
});
