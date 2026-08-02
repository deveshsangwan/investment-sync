import { importBatches } from "@investment-sync/db";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { canManageHousehold } from "../services/membership";
import { commitImport } from "../services/import-service";

export const importsRouter = router({
  commit: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!canManageHousehold(ctx.membership)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only household owners can commit imports",
        });
      }

      return commitImport(ctx, ctx.membership, input.importBatchId);
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.householdId, ctx.membership.householdId))
      .orderBy(desc(importBatches.uploadedAt))
      .limit(50);
  }),
});
