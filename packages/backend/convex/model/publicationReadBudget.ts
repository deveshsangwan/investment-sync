import type { Doc } from "../_generated/dataModel";
import { capacityError } from "./portfolioLimits";

export const publicationReadBudgetLimits = {
  bytes: 8 * 1024 * 1024,
  documentOverheadBytes: 256,
  requestOverheadBytes: 256 * 1024,
} as const;

export function publicationReadBudget(
  receipts: Pick<
    Doc<"publicationReceipts">,
    "stage" | "count" | "modelBytesWritten"
  >[],
) {
  let modelBytes = 0;
  let documents = 0;
  for (const receipt of receipts) {
    if (receipt.stage === "facts") continue;
    if (
      receipt.modelBytesWritten === undefined ||
      !Number.isSafeInteger(receipt.modelBytesWritten) ||
      receipt.modelBytesWritten <= 0
    )
      capacityError(
        "Publication read budget receipt is missing or invalid; retry this import",
      );

    // Asset and holding views read current headers alongside their selected positions.
    const multiplicity = receipt.stage === "positions" ? 2 : 1;
    modelBytes += receipt.modelBytesWritten * multiplicity;
    documents += receipt.count * multiplicity;
  }

  // Write metrics measure logical stored-document bytes. Reserve additional
  // per-document system/index overhead and one request allowance for auth,
  // the version/root manifest, Household, alias and FX reads. Every public view
  // reads a subset of these weighted model rows; staged fact payloads are private.
  // Physical database read bytes remain a separate measured deployment gate.
  const overheadBytes =
    documents * publicationReadBudgetLimits.documentOverheadBytes +
    publicationReadBudgetLimits.requestOverheadBytes;
  const totalBytes = modelBytes + overheadBytes;
  return {
    modelBytes,
    documents,
    overheadBytes,
    totalBytes,
    limitBytes: publicationReadBudgetLimits.bytes,
  };
}

export function requirePublicationReadBudget(
  receipts: Pick<
    Doc<"publicationReceipts">,
    "stage" | "count" | "modelBytesWritten"
  >[],
) {
  const budget = publicationReadBudget(receipts);
  if (budget.totalBytes > budget.limitBytes)
    capacityError(
      "Resulting portfolio exceeds the supported public-view read budget",
    );
  return budget;
}
