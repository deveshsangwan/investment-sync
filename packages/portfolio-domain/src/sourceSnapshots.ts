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
      pnlAmount: sumDecimals(
        selected.map(
          (row) =>
            row.pnlAmount ??
            subtractDecimals(row.currentValue, row.investedAmount),
        ),
      ),
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
      // Legacy charts convert each persisted row before summing. Exact native
      // totals remain authoritative; these ordered inputs preserve display math.
      displayAmounts: [...facts]
        .sort((left, right) => {
          const leftOrder = left.snapshotCreationOrder ?? left.provenance;
          const rightOrder = right.snapshotCreationOrder ?? right.provenance;

          return (
            leftOrder.sequence - rightOrder.sequence ||
            leftOrder.rowNumber - rightOrder.rowNumber
          );
        })
        .map((fact) => [
          fact.row.currency,
          Number(fact.row.investedAmount),
          Number(fact.row.currentValue),
        ]),
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

export function timelineWithManualPolicies(
  holdings: HoldingFact[],
  baseline: NativeTimelinePoint[],
  hasExplicitValuations = false,
): NativeTimelinePoint[] {
  const manualDates = holdings
    .filter(
      (fact) => fact.row.policyId && fact.row.sourceType === "manual_snapshot",
    )
    .map((fact) => fact.snapshotDate)
    .sort();
  const firstManualDate = manualDates[0];

  if (!firstManualDate) return baseline;

  // A manual entry updates one policy. Carry the other positions forward
  // instead of treating every entry date as a complete portfolio snapshot.
  const dates = [
    ...new Set([
      ...holdings.map((fact) => fact.snapshotDate),
      ...baseline.map((point) => point.snapshotDate),
    ]),
  ]
    .filter((date) => date >= firstManualDate)
    .sort();

  const candidates = holdings
    .map((fact, originalIndex) => ({ fact, originalIndex }))
    .sort((left, right) =>
      compareText(left.fact.snapshotDate, right.fact.snapshotDate),
    )
    .values();
  const reportedPoints = baseline.values();
  const groups = new Map<string, TimelineSelectionGroup>();
  const timeline = baseline.filter(
    (point) => point.snapshotDate < firstManualDate,
  );
  let nextCandidate = candidates.next();
  let nextReportedPoint = reportedPoints.next();
  let reportedTotals: NativeTotal[] = [];

  for (const snapshotDate of dates) {
    while (
      !nextCandidate.done &&
      nextCandidate.value.fact.snapshotDate <= snapshotDate
    ) {
      retainTimelineCandidate(groups, nextCandidate.value);
      nextCandidate = candidates.next();
    }

    while (
      !nextReportedPoint.done &&
      nextReportedPoint.value.snapshotDate <= snapshotDate
    ) {
      reportedTotals = nextReportedPoint.value.totals;
      nextReportedPoint = reportedPoints.next();
    }

    const current = currentTimelineHoldings(groups);
    const rows = hasExplicitValuations
      ? [
          ...reportedTotals,
          ...current
            .filter((fact) => fact.row.policyId)
            .map((fact) => fact.row),
        ]
      : current.map((fact) => fact.row);

    timeline.push({ snapshotDate, totals: nativeTotals(rows) });
  }

  return timeline;
}

interface TimelineCandidate {
  fact: HoldingFact;
  originalIndex: number;
}

interface TimelineSelectionGroup {
  completeSnapshot?: { date: string; priority: number };
  candidates: Map<string, TimelineCandidate>;
}

function retainTimelineCandidate(
  groups: Map<string, TimelineSelectionGroup>,
  candidate: TimelineCandidate,
) {
  const { fact } = candidate;
  const groupKey = selectionGroupKey(fact);
  let group = groups.get(groupKey);

  if (!group) {
    group = { candidates: new Map() };
    groups.set(groupKey, group);
  }

  const priority = selectionPriority(fact);
  const complete = group.completeSnapshot;

  if (
    fact.row.source.completeness === "complete" &&
    (!complete ||
      fact.snapshotDate > complete.date ||
      (fact.snapshotDate === complete.date && priority > complete.priority))
  ) {
    group.completeSnapshot = { date: fact.snapshotDate, priority };

    for (const [key, previous] of group.candidates) {
      if (
        previous.fact.snapshotDate < fact.snapshotDate ||
        (previous.fact.snapshotDate === fact.snapshotDate &&
          selectionPriority(previous.fact) < priority)
      ) {
        group.candidates.delete(key);
      }
    }
  }

  if (
    group.completeSnapshot &&
    fact.snapshotDate === group.completeSnapshot.date &&
    priority < group.completeSnapshot.priority
  ) {
    return;
  }

  // Later complete snapshots only remove candidates. Keeping the best row
  // per position in each group retains alternatives from other source groups.
  const previous = group.candidates.get(fact.canonicalPositionKey);

  if (!previous || compareTimelineCandidates(candidate, previous) < 0) {
    group.candidates.set(fact.canonicalPositionKey, candidate);
  }
}

function currentTimelineHoldings(groups: Map<string, TimelineSelectionGroup>) {
  const current = new Map<string, TimelineCandidate>();

  for (const group of groups.values()) {
    for (const candidate of group.candidates.values()) {
      const key = candidate.fact.canonicalPositionKey;
      const previous = current.get(key);

      if (!previous || compareTimelineCandidates(candidate, previous) < 0) {
        current.set(key, candidate);
      }
    }
  }

  return [...current.values()]
    .map((candidate) => candidate.fact)
    .sort(compareHoldings);
}

function compareTimelineCandidates(
  left: TimelineCandidate,
  right: TimelineCandidate,
) {
  // selectPositions uses a stable sort, so equal ranks favor the original row.
  return (
    comparePositionRank(left.fact, right.fact) ||
    left.originalIndex - right.originalIndex
  );
}

function snapshotGroup(fact: HoldingFact): string {
  return JSON.stringify([fact.sourceGroupKey, fact.snapshotDate]);
}
