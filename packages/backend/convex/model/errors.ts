import { narrowPublicError } from "@investment-sync/portfolio-domain";
import { ConvexError } from "convex/values";

/** Keep unexpected database/storage detail in logs, including the operation ID. */
export async function withMutationDiagnostics<Result>(
  operation: string,
  metadata: object,
  handler: () => Promise<Result>,
) {
  try {
    return await handler();
  } catch (error) {
    const diagnosticId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    console.error("Mutation failed", {
      operation,
      diagnosticId,
      batchId: "batchId" in metadata ? metadata.batchId : undefined,
      requestId: "requestId" in metadata ? metadata.requestId : undefined,
      error,
    });

    const failure = narrowPublicError(
      error instanceof ConvexError ? error.data : null,
    );

    throw new ConvexError({
      code: failure.code,
      message: failure.message,
      diagnosticId,
    });
  }
}
