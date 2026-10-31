import { ConvexError } from "convex/values";
import { narrowPublicError } from "@investment-sync/portfolio-domain";

export function clientErrorMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof ConvexError)) return fallback;

  const error = narrowPublicError(cause.data);

  return error.code === "INTERNAL_FAILURE" ? fallback : error.message;
}

const importFailureMessages = [
  "Source file is unavailable or exceeds the import limit",
  "Source file checksum mismatch",
  "Import exceeds 1100 rows or 512 KiB of normalized data",
  "Import exceeds 64 accounts or 512 instruments",
  "A normalized row exceeds the chunk byte limit",
  "Import capacity exceeded",
  "Source file is unavailable",
  "Chunk capacity exceeded",
  "Household history exceeds the supported publication capacity",
  "Resulting household history exceeds the supported publication capacity",
  "Import staging capacity exceeded",
  "Publication manifest capacity exceeded",
  "This import contains a record that is too large to publish. Upload a smaller statement with shorter descriptions.",
  "This file and parser version have already been committed",
  "Resulting portfolio exceeds the supported public-view read budget",
  "Publication read budget receipt is missing or invalid; retry this import",
  "Publication timed out; retry this import",
  "Parsing timed out; retry this import",
  "Source file expired",
] as const;

export function importFailureMessage(
  data: unknown,
  phase: "parse" | "publish",
) {
  const candidate =
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "CAPACITY" &&
    "message" in data
      ? data.message
      : data;
  const message = importFailureMessages.find(
    (message) => message === candidate,
  );

  if (message) return message;

  return phase === "parse"
    ? "This file could not be parsed. Try again or choose another file."
    : "This import could not be published. Try again or choose another file.";
}
