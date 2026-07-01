import { importBatches } from "@investment-sync/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { commitImport } from "../services/import-service";

export const importsRouter = router({
  commit: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      commitImport(ctx, ctx.membership, input.importBatchId),
    ),
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.householdId, ctx.membership.householdId))
      .orderBy(desc(importBatches.uploadedAt))
      .limit(50);
  }),
});
