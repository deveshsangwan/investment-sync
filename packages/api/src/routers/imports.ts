import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { logger } from "../logger";
import {
  commitImport,
  isImportError,
  listImports,
  runImportEffect,
} from "../services/import-service";
import { protectedProcedure, router } from "../trpc";

export const importsRouter = router({
  commit: protectedProcedure
    .input(z.object({ importBatchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await runImportEffect(
          commitImport(ctx, ctx.membership, input.importBatchId),
        );
      } catch (error) {
        throw toImportTrpcError(error);
      }
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await runImportEffect(listImports(ctx, ctx.membership));
    } catch (error) {
      throw toImportTrpcError(error);
    }
  }),
});

function toImportTrpcError(error: unknown) {
  if (!isImportError(error)) {
    logger.error("Unexpected import request failure", { error });
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Import operation failed",
      cause: error,
    });
  }

  logger.error("Import request failed", {
    tag: error._tag,
    cause: "cause" in error ? error.cause : undefined,
  });
  const code = {
    ImportValidationError: "BAD_REQUEST",
    ImportNotFoundError: "NOT_FOUND",
    ImportConflictError: "CONFLICT",
    ImportStorageError: "INTERNAL_SERVER_ERROR",
    ImportPersistenceError: "INTERNAL_SERVER_ERROR",
  }[error._tag] as
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "CONFLICT"
    | "INTERNAL_SERVER_ERROR";
  return new TRPCError({ code, message: error.message, cause: error });
}
