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
  const latestCompleteSnapshots = new Map<
    string,
    { date: string; priority: number }
  >();
  for (const fact of holdings) {
    if (fact.row.source.completeness !== "complete") continue;

    const groupKey = selectionGroupKey(fact);
    const priority = selectionPriority(fact);
    const previous = latestCompleteSnapshots.get(groupKey);
    if (
      !previous ||
      fact.snapshotDate > previous.date ||
      (fact.snapshotDate === previous.date && priority > previous.priority)
    ) {
      latestCompleteSnapshots.set(groupKey, {
        date: fact.snapshotDate,
        priority,
      });
    }
  }

  const current = new Map<string, HoldingFact>();
  const latest = new Map<string, HoldingFact>();
  for (const fact of [...holdings].sort(comparePositionRank)) {
    if (!latest.has(fact.canonicalPositionKey))
      latest.set(fact.canonicalPositionKey, fact);

    const complete = latestCompleteSnapshots.get(selectionGroupKey(fact));
    const isCurrent =
      !complete ||
      fact.snapshotDate > complete.date ||
      (fact.snapshotDate === complete.date &&
        selectionPriority(fact) >= complete.priority);
    if (isCurrent && !current.has(fact.canonicalPositionKey)) {
      current.set(fact.canonicalPositionKey, fact);
    }
  }

  // Current and exited are independent legacy selections. An older source
  // group can still be current while another group records an omission.
  const exited = [...latest.values()].filter((fact) => {
    const complete = latestCompleteSnapshots.get(selectionGroupKey(fact));
    return (
      complete !== undefined &&
      (fact.snapshotDate < complete.date ||
        (fact.snapshotDate === complete.date &&
          selectionPriority(fact) < complete.priority))
    );
  });

  return {
    current: [...current.values()].sort(compareHoldings),
    exited: exited.sort(compareHoldings),
  };
}

function comparePositionRank(left: HoldingFact, right: HoldingFact): number {
  return (
    compareText(right.snapshotDate, left.snapshotDate) ||
    selectionPriority(right) - selectionPriority(left) ||
    compareHoldings(left, right)
  );
}

function compareHoldings(left: HoldingFact, right: HoldingFact): number {
  return (
    compareText(right.snapshotDate, left.snapshotDate) ||
    compareText(left.row.instrumentName, right.row.instrumentName) ||
    compareText(
      right.provenance.legacyId ?? right.factKey,
      left.provenance.legacyId ?? left.factKey,
    )
  );
}

function selectionGroupKey(fact: HoldingFact): string {
  const { row } = fact;
  const isWorkbookSource =
    row.accountName === "US Stocks" &&
    row.provider === "Manual Workbook" &&
    row.sourceType === "investment_portfolio_xlsx" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    row.metadata.sourceSheet === "US stocks";

  // The known importer representations share omission semantics while their
  // physical source groups remain separate for aggregates and history.
  return isWorkbookSource || isVestedSource(row)
    ? JSON.stringify(["workbook-vested-us-stocks"])
    : fact.sourceGroupKey;
}

function selectionPriority(fact: HoldingFact): number {
  return isVestedSource(fact.row) ? 1 : 0;
}

function isVestedSource(row: HoldingFact["row"]): boolean {
  return (
    row.accountName === "US Stocks" &&
    row.provider === "Vested / DriveWealth" &&
    row.sourceType === "vested_drivewealth_xlsx" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    (row.metadata.sourceSheet ?? "") === ""
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
