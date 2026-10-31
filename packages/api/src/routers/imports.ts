import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { logger } from "../logger";
import {
  commitImport,
  publicImportError,
  listImports,
  runImportEffect,
} from "../services/import-service";
import { canManageHousehold } from "../services/membership";
import { protectedProcedure, router } from "../trpc";

export const importsRouter = router({
  commit: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Stays outside the try below: this TRPCError must reach the client as
      // FORBIDDEN, not be remapped by toImportTrpcError.
      if (!canManageHousehold(ctx.membership)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only household owners can commit imports",
        });
      }

      try {
        return await runImportEffect(
          commitImport(ctx, ctx.membership, input.importBatchId),
        );
      } catch (error) {
        throw toImportTrpcError(error, { importBatchId: input.importBatchId });
      }
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await runImportEffect(listImports(ctx, ctx.membership));
    } catch (error) {
      throw toImportTrpcError(error, {});
    }
  }),
});

export function toImportTrpcError(
  error: unknown,
  context: { importBatchId?: string },
) {
  const failure = publicImportError(error);
  const requestId = randomUUID();
  logger.error("Import request failed", {
    ...context,
    requestId,
    code: failure.code,
    error,
  });
  const code =
    failure.status === 400
      ? "BAD_REQUEST"
      : failure.status === 404
        ? "NOT_FOUND"
        : failure.status === 409
          ? "CONFLICT"
          : "INTERNAL_SERVER_ERROR";

  return new TRPCError({ code, message: failure.message, cause: error });
}
