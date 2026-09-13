import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  accountKey,
  instrumentKey,
  sourceGroupKey,
  canonicalPositionKey,
  positionKey,
} from "./identity";
import { compareText } from "./ordering";
import { groupBy } from "./grouping";
import { canonicalDecimal, FinancialDecimal } from "./numeric";
import {
  eligibleSnapshots,
  nativeTotals,
  selectPositions,
  snapshotTimeline,
  valuationTimeline,
} from "./sourceSnapshots";
import type {
  HoldingFact,
  HoldingRow,
  IdentifiedFact,
  PortfolioFact,
  PortfolioPublication,
  PublicationInput,
  TransactionFact,
  ValuationRow,
  PositionProjection,
} from "./types";

export function buildPortfolioPublication(
  input: PublicationInput,
): PortfolioPublication {
  const batch = input.batch;
  const incoming =
    batch?.rows.map((row, index) => ({
      row,
      provenance: {
        batchId: batch.id,
        parserVersion: batch.parserVersion,
        sequence: batch.sequence,
        fallbackDate: batch.fallbackDate,
        rowNumber: index + 1,
      },
    })) ?? [];
  const factsByKey = new Map<string, PortfolioFact>();
  const newFactKeys = new Set<string>();

  for (const [index, stored] of [
    ...input.existingFacts,
    ...incoming,
  ].entries()) {
    // Persistence may attach derived identity fields. Only immutable source
    // content participates in replay comparison and publication digests.
    const fact = { row: stored.row, provenance: stored.provenance };
    validateFact(fact);
    const key = JSON.stringify([
      fact.provenance.batchId,
      fact.provenance.rowNumber,
    ]);
    const existing = factsByKey.get(key);
    if (existing && stableJson(existing) !== stableJson(fact)) {
      throw new Error("Conflicting content for an immutable import row");
    }

    if (!existing) {
      factsByKey.set(key, fact);
      if (index >= input.existingFacts.length) newFactKeys.add(key);
    }
  }

  const facts = [...factsByKey.values()].sort(compareFacts);
  const { holdings, transactions, valuations, identifiedFacts } =
    resolveFacts(facts);
  const eligible = eligibleSnapshots(holdings);
  const selected = selectPositions(eligible);
  const currentFacts = new Set(selected.current);
  const datedHoldings = [...holdings].sort(bySnapshotDate);
  const historyByPosition = groupBy(datedHoldings, (fact) => fact.positionKey);
  const historyByInstrument = groupBy(
    datedHoldings,
    (fact) => fact.instrumentKey,
  );
  const transactionsByInstrument = groupBy(
    transactions,
    (fact) => fact.instrumentKey,
  );
  const transactionsByAccountInstrument = groupBy(transactions, (fact) =>
    JSON.stringify([fact.accountKey, fact.instrumentKey]),
  );
  const projectPosition = (holding: HoldingFact): PositionProjection => ({
    positionKey: holding.positionKey,
    status: currentFacts.has(holding)
      ? ("current" as const)
      : ("exited" as const),
    holding,
    history: historyByPosition.get(holding.positionKey) ?? [],
    transactions:
      transactionsByAccountInstrument.get(
        JSON.stringify([holding.accountKey, holding.instrumentKey]),
      ) ?? [],
    instrumentHistory: historyByInstrument.get(holding.instrumentKey) ?? [],
    instrumentTransactions:
      transactionsByInstrument.get(holding.instrumentKey) ?? [],
  });
  const positions = [...selected.current, ...selected.exited].map(
    projectPosition,
  );
  const visiblePositionKeys = new Set(
    positions.map((position) => position.positionKey),
  );
  const latestByPosition = new Map(
    datedHoldings.map((holding) => [holding.positionKey, holding]),
  );
  const detailPositions = [...latestByPosition.values()]
    .filter((holding) => !visiblePositionKeys.has(holding.positionKey))
    .map(projectPosition);
  const totals = nativeTotals(selected.current.map((fact) => fact.row));
  const assetClasses = [...new Set(eligible.map((fact) => fact.row.assetClass))]
    .sort()
    .map((assetClass) => ({
      assetClass,
      totals: nativeTotals(
        selected.current
          .filter((fact) => fact.row.assetClass === assetClass)
          .map((fact) => fact.row),
      ),
      timeline: snapshotTimeline(
        eligible.filter((fact) => fact.row.assetClass === assetClass),
      ),
    }));
  const projection = {
    projectorVersion: "portfolio-v1" as const,
    asOfDate: selected.current[0]?.snapshotDate ?? null,
    positions,
    detailPositions,
    totals,
    assetClasses,
    timeline: valuations.length
      ? valuationTimeline(valuations)
      : snapshotTimeline(eligible),
    hasExplicitValuations: valuations.length > 0,
    valuations,
    cashFlows: transactions,
  };
  const reconciliation = {
    factCount: facts.length,
    holdingCount: holdings.length,
    transactionCount: transactions.length,
    valuationCount: valuations.length,
    currentCount: selected.current.length,
    exitedCount: selected.exited.length,
    nativeTotals: totals,
  };

  return {
    facts,
    factsToPersist: identifiedFacts.filter((fact) =>
      newFactKeys.has(
        JSON.stringify([fact.provenance.batchId, fact.provenance.rowNumber]),
      ),
    ),
    identifiedFacts,
    projection,
    reconciliation,
    digest: bytesToHex(
      // Derived histories repeat immutable facts. Hash the versioned inputs
      // and reconciliation once so digest work scales with source history.
      sha256(
        stableJson({
          format: "portfolio-input-v2",
          projectorVersion: projection.projectorVersion,
          facts,
          reconciliation,
        }),
      ),
    ),
  };
}

function resolveFacts(facts: PortfolioFact[]) {
  const holdings = new Map<string, HoldingFact>();
  const transactions = new Map<string, TransactionFact>();
  const valuations = new Map<string, ValuationRow>();
  const occurrences = new Map<string, number>();
  const identifiedFacts: IdentifiedFact[] = [];
  const accountNames = new Map<
    string,
    { accountName: string; provider: string }
  >();
  const instrumentNames = new Map<
    string,
    { instrumentName: string; symbol?: string; isin?: string }
  >();

  for (const fact of facts) {
    const { provenance } = fact;
    if (fact.row.kind === "valuation") {
      const row = fact.row;
      identifiedFacts.push({
        ...fact,
        identity: { kind: "valuation", valuationKey: row.valuationDate },
      });
      valuations.set(row.valuationDate, {
        ...row,
        investedAmount: scaled(row.investedAmount, 4),
        currentValue: scaled(row.currentValue, 4),
        pnlAmount: scaled(
          row.pnlAmount ??
            new FinancialDecimal(row.currentValue)
              .minus(row.investedAmount)
              .toFixed(),
          4,
        ),
      });
      continue;
    }

    const account = accountKey(fact.row);
    const instrument = instrumentKey(fact.row);
    if (!accountNames.has(account))
      accountNames.set(account, {
        accountName: fact.row.accountName.trim(),
        provider: fact.row.provider.trim(),
      });
    if (!instrumentNames.has(instrument))
      instrumentNames.set(instrument, {
        instrumentName: fact.row.instrumentName.trim(),
        symbol: fact.row.symbol?.trim() || undefined,
        ...("isin" in fact.row
          ? { isin: fact.row.isin?.trim() || undefined }
          : {}),
      });
    const row = {
      ...fact.row,
      ...accountNames.get(account),
      ...instrumentNames.get(instrument),
    };

    if (row.kind === "holding") {
      const snapshotDate = row.sourceDate ?? provenance.fallbackDate;
      const key = JSON.stringify([account, instrument, snapshotDate]);
      identifiedFacts.push({
        ...fact,
        identity: {
          kind: "holding",
          accountKey: account,
          instrumentKey: instrument,
          positionKey: positionKey(row),
          sourceGroupKey: sourceGroupKey(row),
          canonicalPositionKey: canonicalPositionKey(row),
          snapshotKey: key,
          snapshotDate,
        },
      });
      const existing = holdings.get(key);
      if (existing && existing.row.source.priority > row.source.priority)
        continue;

      const normalized: HoldingRow = {
        ...row,
        quantity: optionalScaled(row.quantity, 10),
        investedAmount: scaled(row.investedAmount, 4),
        currentValue: scaled(row.currentValue, 4),
        pnlAmount: optionalScaled(row.pnlAmount, 4),
        pnlPercent:
          row.pnlPercent === undefined
            ? undefined
            : Number(scaled(String(row.pnlPercent), 6, 12)),
      };
      holdings.set(key, {
        row: normalized,
        provenance,
        snapshotDate,
        accountKey: account,
        instrumentKey: instrument,
        positionKey: positionKey(row),
        canonicalPositionKey: canonicalPositionKey(row),
        sourceGroupKey: sourceGroupKey(row),
        factKey: key,
      });
      continue;
    }

    const fingerprint = JSON.stringify([
      account,
      instrument,
      row.sourceType,
      row.source.group,
      row.tradeDate,
      row.type,
      scaled(row.amount, 4),
      row.currency,
    ]);
    const batchFingerprint = JSON.stringify([provenance.batchId, fingerprint]);
    const occurrence = (occurrences.get(batchFingerprint) ?? 0) + 1;
    occurrences.set(batchFingerprint, occurrence);
    const occurrenceKey = JSON.stringify([fingerprint, occurrence]);
    identifiedFacts.push({
      ...fact,
      identity: {
        kind: "transaction",
        accountKey: account,
        instrumentKey: instrument,
        positionKey: positionKey(row),
        occurrenceKey,
      },
    });
    transactions.set(occurrenceKey, {
      row: {
        ...row,
        amount: scaled(row.amount, 4),
        quantity: optionalScaled(row.quantity, 10),
        price: optionalScaled(row.price, 10),
      },
      provenance,
      accountKey: account,
      instrumentKey: instrument,
      positionKey: positionKey(row),
      occurrenceKey,
    });
  }

  return {
    identifiedFacts,
    holdings: [...holdings.values()],
    transactions: [...transactions.values()].sort(
      (a, b) =>
        compareText(a.row.tradeDate, b.row.tradeDate) ||
        compareText(a.occurrenceKey, b.occurrenceKey),
    ),
    valuations: [...valuations.values()].sort((a, b) =>
      compareText(a.valuationDate, b.valuationDate),
    ),
  };
}

function validateFact(fact: PortfolioFact) {
  const { row, provenance } = fact;
  if (
    !provenance.batchId ||
    !provenance.parserVersion ||
    !Number.isSafeInteger(provenance.sequence) ||
    provenance.sequence < 0 ||
    !Number.isSafeInteger(provenance.rowNumber) ||
    provenance.rowNumber < 1
  ) {
    throw new Error("Invalid import provenance");
  }

  const date =
    row.kind === "holding"
      ? (row.sourceDate ?? provenance.fallbackDate)
      : row.kind === "valuation"
        ? row.valuationDate
        : row.tradeDate;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid financial date");
  }

  if (
    row.kind !== "valuation" &&
    (!row.accountName.trim() ||
      !row.provider.trim() ||
      !row.instrumentName.trim())
  )
    throw new Error("Empty portfolio identity");
  if (!Number.isFinite(row.source.priority))
    throw new Error("Invalid source priority");

  const values =
    row.kind === "transaction"
      ? [row.amount, row.quantity, row.price]
      : [
          row.investedAmount,
          row.currentValue,
          row.pnlAmount,
          ...(row.kind === "holding" ? [row.quantity] : []),
        ];
  for (const value of values) {
    if (value !== undefined) canonicalDecimal(value);
  }
}

function scaled(value: string, scale: number, precision = 28): string {
  const rounded = new FinancialDecimal(value).toDecimalPlaces(
    scale,
    FinancialDecimal.ROUND_HALF_UP,
  );
  if (rounded.abs().gte(new FinancialDecimal(10).pow(precision - scale))) {
    throw new Error(
      `Financial value exceeds numeric(${precision},${scale}) capacity`,
    );
  }

  return rounded.toFixed();
}

function optionalScaled(
  value: string | undefined,
  scale: number,
): string | undefined {
  return value === undefined ? undefined : scaled(value, scale);
}

function compareFacts(left: PortfolioFact, right: PortfolioFact): number {
  return (
    left.provenance.sequence - right.provenance.sequence ||
    compareText(left.provenance.batchId, right.provenance.batchId) ||
    left.provenance.rowNumber - right.provenance.rowNumber
  );
}

function bySnapshotDate(left: HoldingFact, right: HoldingFact): number {
  return (
    compareText(left.snapshotDate, right.snapshotDate) ||
    compareFacts(left, right)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => stableJson(entry ?? null)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;

  return JSON.stringify(value) ?? "null";
}
