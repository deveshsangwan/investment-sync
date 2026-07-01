import { accounts } from "@investment-sync/db";
import { and, eq } from "drizzle-orm";
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
});
