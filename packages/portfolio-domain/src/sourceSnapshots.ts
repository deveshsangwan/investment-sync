import type {
  HoldingFact,
  NativeTimelinePoint,
  NativeTotal,
  ValuationRow,
} from "./types";
import { subtractDecimals, sumDecimals } from "./numeric";
import { compareText } from "./ordering";
import { groupBy } from "./grouping";

export function eligibleSnapshots(holdings: HoldingFact[]): HoldingFact[] {
  const detailedGroups = new Set(
    holdings
      .filter((fact) => fact.row.source.granularity === "instrument")
      .map(snapshotGroup),
  );

  return holdings.filter(
    (fact) =>
      fact.row.source.granularity === "instrument" ||
      !detailedGroups.has(snapshotGroup(fact)),
  );
}

export function selectPositions(holdings: HoldingFact[]) {
  const completeDates = new Map<string, string>();
  for (const fact of holdings) {
    if (fact.row.source.completeness !== "complete") continue;

    const previous = completeDates.get(fact.sourceGroupKey);
    if (!previous || fact.snapshotDate > previous) {
      completeDates.set(fact.sourceGroupKey, fact.snapshotDate);
    }
  }

  const current = new Map<string, HoldingFact>();
  const latest = new Map<string, HoldingFact>();
  for (const fact of [...holdings].sort(compareHoldings)) {
    if (!latest.has(fact.canonicalPositionKey))
      latest.set(fact.canonicalPositionKey, fact);

    const completeDate = completeDates.get(fact.sourceGroupKey);
    if (
      (!completeDate || fact.snapshotDate >= completeDate) &&
      !current.has(fact.canonicalPositionKey)
    ) {
      current.set(fact.canonicalPositionKey, fact);
    }
  }

  // Current and exited are independent legacy selections. An older source
  // group can still be current while another group records an omission.
  const exited = [...latest.values()].filter((fact) => {
    const completeDate = completeDates.get(fact.sourceGroupKey);
    return completeDate !== undefined && fact.snapshotDate < completeDate;
  });
  return { current: [...current.values()], exited };
}

export function compareHoldings(left: HoldingFact, right: HoldingFact): number {
  return (
    compareText(right.snapshotDate, left.snapshotDate) ||
    compareText(left.row.instrumentName, right.row.instrumentName) ||
    compareText(
      right.provenance.legacyId ?? right.factKey,
      left.provenance.legacyId ?? left.factKey,
    )
  );
}

export function nativeTotals(
  rows: Array<{
    currency: NativeTotal["currency"];
    investedAmount: string;
    currentValue: string;
    pnlAmount?: string;
  }>,
): NativeTotal[] {
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  return currencies.map((currency) => {
    const selected = rows.filter((row) => row.currency === currency);
    const investedAmount = sumDecimals(
      selected.map((row) => row.investedAmount),
    );
    const currentValue = sumDecimals(selected.map((row) => row.currentValue));

    return {
      currency,
      investedAmount,
      currentValue,
      pnlAmount: sumDecimals(selected.map((row) => row.pnlAmount ?? "0")),
    };
  });
}

export function snapshotTimeline(
  holdings: HoldingFact[],
): NativeTimelinePoint[] {
  return [...groupBy(holdings, (fact) => fact.snapshotDate)]
    .sort(([left], [right]) => compareText(left, right))
    .map(([snapshotDate, facts]) => ({
      snapshotDate,
      totals: nativeTotals(facts.map((fact) => fact.row)),
    }));
}

export function valuationTimeline(
  valuations: ValuationRow[],
): NativeTimelinePoint[] {
  return [...groupBy(valuations, (row) => row.valuationDate)]
    .sort(([left], [right]) => compareText(left, right))
    .map(([snapshotDate, rows]) => ({
      snapshotDate,
      totals: nativeTotals(
        rows.map((row) => ({
          ...row,
          pnlAmount:
            row.pnlAmount ??
            subtractDecimals(row.currentValue, row.investedAmount),
        })),
      ),
    }));
}

function snapshotGroup(fact: HoldingFact): string {
  return JSON.stringify([fact.sourceGroupKey, fact.snapshotDate]);
}
