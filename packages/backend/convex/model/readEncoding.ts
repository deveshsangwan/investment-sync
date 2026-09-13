import {
  exactNormalizedHoldingRowSchema,
  exactNormalizedTransactionRowSchema,
  exactNormalizedValuationRowSchema,
} from "@investment-sync/importers/exact-types";
import type {
  HoldingFact,
  PositionProjection,
  TransactionFact,
  ValuationRow,
} from "@investment-sync/portfolio-domain";
import { z } from "zod";
import type { Doc, Id } from "../_generated/dataModel";

const provenanceSchema = z.object({
  batchId: z.string(),
  parserVersion: z.string(),
  sequence: z.number().int(),
  rowNumber: z.number().int(),
  fallbackDate: z.string(),
  legacyId: z.string().optional(),
});
const holdingPayloadSchema = z.object({
  row: exactNormalizedHoldingRowSchema,
  provenance: provenanceSchema,
});
const transactionPayloadSchema = z.object({
  row: exactNormalizedTransactionRowSchema,
  provenance: provenanceSchema,
  occurrenceKey: z.string(),
});
const valuationPayloadSchema = exactNormalizedValuationRowSchema;
const accountInstrumentSchema = z.tuple([z.string(), z.string()]);

export interface ScopeFactSource {
  factsById: Map<Id<"portfolioHistoryFacts">, Doc<"portfolioHistoryFacts">>;
  factIdsByScope: Map<string, Id<"portfolioHistoryFacts">[]>;
  factsByScope: Map<string, Doc<"portfolioHistoryFacts">[]>;
  holdingPayloadsById: Map<
    Id<"portfolioHistoryFacts">,
    z.infer<typeof holdingPayloadSchema>
  >;
  transactionPayloadsById: Map<
    Id<"portfolioHistoryFacts">,
    z.infer<typeof transactionPayloadSchema>
  >;
}

export function decodePositionHeader(doc: Doc<"portfolioPositions">) {
  const payload = parseJson(doc.holdingJson, holdingPayloadSchema);
  const [accountKey, instrumentKey] = decodeTransactionScope(
    doc.transactionScope,
  );
  const holding = holdingFact(payload, {
    accountKey,
    instrumentKey,
    positionKey: doc.positionKey,
    factKey: primaryFactKey(payload.provenance),
  });

  return {
    positionKey: doc.positionKey,
    status: doc.status === "current" ? "current" : "exited",
    holding,
    history: [],
    transactions: [],
    instrumentHistory: [],
    instrumentTransactions: [],
  } satisfies PositionProjection;
}

export function decodePosition(
  doc: Doc<"portfolioPositions">,
  source: ScopeFactSource,
) {
  const header = decodePositionHeader(doc);
  const history = decodeHoldingScope(doc.historyScope, header, source);
  const transactions = decodeTransactionScopeFacts(
    doc.transactionScope,
    header,
    source,
  );
  const instrumentHistory = decodeHoldingScope(
    doc.instrumentHistoryScope,
    header,
    source,
  );
  const instrumentTransactions = decodeTransactionScopeFacts(
    doc.instrumentTransactionScope,
    header,
    source,
  );
  const holding =
    history.find(
      (fact) =>
        fact.provenance.batchId === header.holding.provenance.batchId &&
        fact.provenance.sequence === header.holding.provenance.sequence &&
        fact.provenance.rowNumber === header.holding.provenance.rowNumber,
    ) ?? header.holding;

  return {
    ...header,
    holding,
    history,
    transactions,
    instrumentHistory,
    instrumentTransactions,
  } satisfies PositionProjection;
}

export function decodePortfolioTransaction(doc: Doc<"portfolioHistoryFacts">) {
  if (doc.kind !== "transaction")
    throw new Error("Portfolio history fact has the wrong kind");
  const payload = parseJson(doc.factJson, transactionPayloadSchema);
  const [accountKey, instrumentKey] = doc.transactionScope
    ? decodeTransactionScope(doc.transactionScope)
    : ["", ""];

  return {
    row: payload.row,
    provenance: payload.provenance,
    accountKey,
    instrumentKey,
    positionKey: doc.positionKey ?? "",
    occurrenceKey: payload.occurrenceKey,
  } satisfies TransactionFact;
}

export function decodePortfolioValuation(doc: Doc<"portfolioHistoryFacts">) {
  if (doc.kind !== "valuation")
    throw new Error("Portfolio history fact has the wrong kind");

  return parseJson(doc.factJson, valuationPayloadSchema) satisfies ValuationRow;
}

function decodeHoldingScope(
  scope: string,
  header: PositionProjection,
  source: ScopeFactSource,
) {
  return scopeFacts(scope, source).map((doc) => {
    if (doc.kind !== "holding")
      throw new Error("Portfolio holding scope contains the wrong fact kind");
    const payload = holdingPayload(doc, source);

    return holdingFact(payload, {
      accountKey: header.holding.accountKey,
      instrumentKey: header.holding.instrumentKey,
      positionKey: doc.positionKey ?? header.positionKey,
      factKey: stripFactKind(doc.key, "holding"),
    });
  });
}

function decodeTransactionScopeFacts(
  scope: string,
  header: PositionProjection,
  source: ScopeFactSource,
) {
  return scopeFacts(scope, source).map((doc) => {
    if (doc.kind !== "transaction")
      throw new Error(
        "Portfolio transaction scope contains the wrong fact kind",
      );
    const payload = transactionPayload(doc, source);

    return {
      row: payload.row,
      provenance: payload.provenance,
      accountKey: header.holding.accountKey,
      instrumentKey: header.holding.instrumentKey,
      positionKey: doc.positionKey ?? header.positionKey,
      occurrenceKey: payload.occurrenceKey,
    } satisfies TransactionFact;
  });
}

function holdingPayload(
  doc: Doc<"portfolioHistoryFacts">,
  source: ScopeFactSource,
) {
  const cached = source.holdingPayloadsById.get(doc._id);
  if (cached) return cached;

  const payload = parseJson(doc.factJson, holdingPayloadSchema);
  source.holdingPayloadsById.set(doc._id, payload);

  return payload;
}

function transactionPayload(
  doc: Doc<"portfolioHistoryFacts">,
  source: ScopeFactSource,
) {
  const cached = source.transactionPayloadsById.get(doc._id);
  if (cached) return cached;

  const payload = parseJson(doc.factJson, transactionPayloadSchema);
  source.transactionPayloadsById.set(doc._id, payload);

  return payload;
}

function scopeFacts(scope: string, source: ScopeFactSource) {
  const cached = source.factsByScope.get(scope);
  if (cached) return cached;

  const facts = (source.factIdsByScope.get(scope) ?? []).map((factId) => {
    const fact = source.factsById.get(factId);
    if (!fact) throw new Error("Portfolio history scope is incomplete");

    return fact;
  });
  source.factsByScope.set(scope, facts);

  return facts;
}

function holdingFact(
  payload: z.infer<typeof holdingPayloadSchema>,
  identity: {
    accountKey: string;
    instrumentKey: string;
    positionKey: string;
    factKey: string;
  },
) {
  return {
    row: payload.row,
    provenance: payload.provenance,
    accountKey: identity.accountKey,
    instrumentKey: identity.instrumentKey,
    positionKey: identity.positionKey,
    canonicalPositionKey: identity.positionKey,
    sourceGroupKey: identity.positionKey,
    snapshotDate: payload.row.sourceDate ?? payload.provenance.fallbackDate,
    factKey: identity.factKey,
  } satisfies HoldingFact;
}

function decodeTransactionScope(scope: string) {
  const prefix = "transactions:";
  if (!scope.startsWith(prefix))
    throw new Error("Invalid portfolio transaction scope");

  return parseJson(scope.slice(prefix.length), accountInstrumentSchema);
}

function stripFactKind(key: string, kind: "holding" | "transaction") {
  const prefix = `${kind}:`;
  if (!key.startsWith(prefix)) throw new Error("Invalid portfolio history key");

  return key.slice(prefix.length);
}

function primaryFactKey(provenance: z.infer<typeof provenanceSchema>) {
  return JSON.stringify([
    provenance.batchId,
    provenance.sequence,
    provenance.rowNumber,
  ]);
}

function parseJson<T>(json: string, schema: z.ZodType<T>): T {
  const value: unknown = JSON.parse(json);

  return schema.parse(value);
}
