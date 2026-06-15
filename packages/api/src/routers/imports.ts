import { importBatches, importRows } from "@investment-sync/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  commitImport,
  createImportUpload,
  dedupePortfolioData,
  processImport,
} from "../services/import-service";

export const importsRouter = router({
  createUpload: protectedProcedure
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) =>
      createImportUpload(ctx, ctx.membership, input.fileName),
    ),
  // Legacy/internal path for clients that cannot use multipart uploads.
  process: protectedProcedure
    .input(
      z.object({
        importBatchId: z.string().uuid(),
        fileName: z.string().min(1),
        base64Content: z.string().min(1),
        mimeType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      processImport(ctx, ctx.membership, {
        importBatchId: input.importBatchId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        content: Buffer.from(input.base64Content, "base64"),
      }),
    ),
  commit: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) =>
      commitImport(ctx, ctx.membership, input.importBatchId),
    ),
  dedupe: protectedProcedure.mutation(async ({ ctx }) =>
    dedupePortfolioData(ctx, ctx.membership),
  ),
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.householdId, ctx.membership.householdId))
      .orderBy(desc(importBatches.uploadedAt))
      .limit(50);
  }),
  rows: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: importRows.id,
          rowNumber: importRows.rowNumber,
          payload: importRows.normalizedPayload,
        })
        .from(importRows)
        .innerJoin(
          importBatches,
          eq(importRows.importBatchId, importBatches.id),
        )
        .where(
          and(
            eq(importRows.importBatchId, input.importBatchId),
            eq(importBatches.householdId, ctx.membership.householdId),
          ),
        );
    }),
});
