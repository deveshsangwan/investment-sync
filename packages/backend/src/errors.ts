import { ConvexError } from "convex/values";
import { narrowPublicError } from "@investment-sync/portfolio-domain";

export function clientErrorMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof ConvexError)) return fallback;

  const error = narrowPublicError(cause.data);

  return error.code === "INTERNAL_FAILURE" ? fallback : error.message;
}
