import type {
  HoldingFact,
  SourceSnapshotFact,
  ImportProvenance,
  NativeTimelinePoint,
  NativeTotal,
  ValuationRow,
} from "./types";
import { FinancialDecimal, subtractDecimals, sumDecimals } from "./numeric";
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

export function selectPositions(
  holdings: HoldingFact[],
  declarations: SourceSnapshotFact[] = [],
) {
  const latestCompleteSnapshots = new Map<string, CompleteSnapshot>();
  for (const fact of [...holdings, ...declarations]) {
    if (fact.row.source.completeness !== "complete") continue;

    const groupKey = selectionGroupKey(fact);
    const priority = selectionPriority(fact);
    const previous = latestCompleteSnapshots.get(groupKey);
    const next: CompleteSnapshot = {
      date: fact.snapshotDate,
      priority,
      ...(fact.row.kind === "source_snapshot"
        ? {
            declaration: {
              provenance: fact.provenance,
              sourcePriority: fact.row.source.priority,
            },
          }
        : {}),
    };
    if (isNewCompleteSnapshot(previous, next))
      latestCompleteSnapshots.set(groupKey, next);
  }

  const current = new Map<string, HoldingFact>();
  const latest = new Map<string, HoldingFact>();
  for (const fact of [...holdings].sort(comparePositionRank)) {
    if (!latest.has(fact.canonicalPositionKey))
      latest.set(fact.canonicalPositionKey, fact);

    const complete = latestCompleteSnapshots.get(selectionGroupKey(fact));
    const isCurrent = !complete || isCurrentAtSnapshot(fact, complete);
    if (isCurrent && !current.has(fact.canonicalPositionKey)) {
      current.set(fact.canonicalPositionKey, fact);
    }
  }

  // Current and exited are independent legacy selections. An older source
  // group can still be current while another group records an omission.
  const exited = [...latest.values()].filter((fact) => {
    const complete = latestCompleteSnapshots.get(selectionGroupKey(fact));
    return complete !== undefined && !isCurrentAtSnapshot(fact, complete);
  });

  return {
    current: [...current.values()].sort(compareHoldings),
    exited: exited.sort(compareHoldings),
  };
}

interface CompleteSnapshot {
  date: string;
  priority: number;
  declaration?: { provenance: ImportProvenance; sourcePriority: number };
}

function compareSourceOrder(left: ImportProvenance, right: ImportProvenance) {
  return (
    (left.sourceSequence ?? left.sequence) -
      (right.sourceSequence ?? right.sequence) ||
    compareText(left.batchId, right.batchId) ||
    left.rowNumber - right.rowNumber
  );
}

function isNewCompleteSnapshot(
  previous: CompleteSnapshot | undefined,
  next: CompleteSnapshot,
) {
  if (!previous) return true;

  if (next.date !== previous.date) return next.date > previous.date;

  if (next.priority !== previous.priority)
    return next.priority > previous.priority;

  if (!next.declaration) return false;

  if (!previous.declaration) return true;

  if (next.declaration.sourcePriority !== previous.declaration.sourcePriority)
    return (
      next.declaration.sourcePriority > previous.declaration.sourcePriority
    );

  return (
    compareSourceOrder(
      next.declaration.provenance,
      previous.declaration.provenance,
    ) > 0
  );
}

function isCurrentAtSnapshot(fact: HoldingFact, complete: CompleteSnapshot) {
  if (fact.snapshotDate !== complete.date)
    return fact.snapshotDate > complete.date;

  const priority = selectionPriority(fact);
  if (priority !== complete.priority) return priority > complete.priority;

  if (!complete.declaration) return true;

  if (fact.row.source.priority !== complete.declaration.sourcePriority)
    return fact.row.source.priority > complete.declaration.sourcePriority;

  return (
    fact.provenance.batchId === complete.declaration.provenance.batchId ||
    compareSourceOrder(fact.provenance, complete.declaration.provenance) > 0
  );
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

function selectionGroupKey(fact: HoldingFact | SourceSnapshotFact): string {
  const { row } = fact;
  const isWorkbookSource =
    row.accountName === "US Stocks" &&
    row.provider === "Manual Workbook" &&
    row.sourceType === "investment_portfolio_xlsx" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    (row.kind === "source_snapshot"
      ? row.sourceGroup
      : row.metadata.sourceSheet) === "US stocks";

  // The known importer representations share omission semantics while their
  // physical source groups remain separate for aggregates and history.
  return isWorkbookSource || isVestedSource(row)
    ? JSON.stringify(["workbook-vested-us-stocks"])
    : fact.sourceGroupKey;
}

function selectionPriority(fact: HoldingFact | SourceSnapshotFact): number {
  return isVestedSource(fact.row) ? 1 : 0;
}

function isVestedSource(
  row: HoldingFact["row"] | SourceSnapshotFact["row"],
): boolean {
  return (
    row.accountName === "US Stocks" &&
    row.provider === "Vested / DriveWealth" &&
    row.sourceType === "vested_drivewealth_xlsx" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    (row.kind === "source_snapshot"
      ? row.sourceGroup
      : (row.metadata.sourceSheet ?? "")) === ""
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
  declarations: SourceSnapshotFact[] = [],
): NativeTimelinePoint[] {
  if (declarations.length) {
    return timelineWithManualPolicies(
      holdings,
      snapshotTimeline(holdings),
      false,
      new Set(),
      declarations,
    );
  }

  const groups = groupBy(holdings, (fact) => fact.snapshotDate);
  return [...groups]
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
  archivedAccountKeys: ReadonlySet<string> = new Set(),
  declarations: SourceSnapshotFact[] = [],
): NativeTimelinePoint[] {
  const manualDates = holdings
    .filter(
      (fact) => fact.row.policyId && fact.row.sourceType === "manual_snapshot",
    )
    .map((fact) => fact.snapshotDate)
    .sort();
  const firstDeclarationDate = declarations
    .map((fact) => fact.snapshotDate)
    .sort()[0];
  const firstSelectionDate = [manualDates[0], firstDeclarationDate]
    .filter((date): date is string => date !== undefined)
    .sort()[0];

  if (!firstSelectionDate) return baseline;

  // An explicit aggregate is authoritative on its reported date. Later complete
  // account reports use the retained holding scopes, like the current summary.
  // Their boundary is not a synthetic financial valuation.
  if (hasExplicitValuations && firstDeclarationDate) {
    const sourcePoints = snapshotTimeline(
      holdings.filter((fact) => !fact.row.policyId),
      declarations,
    ).filter((point) => point.snapshotDate >= firstDeclarationDate);
    baseline = [
      ...new Map(
        [...sourcePoints, ...baseline].map((point) => [
          point.snapshotDate,
          point,
        ]),
      ).values(),
    ].sort((left, right) => compareText(left.snapshotDate, right.snapshotDate));
  }

  // A manual entry updates one policy. Carry the other positions forward
  // instead of treating every entry date as a complete portfolio snapshot.
  const dates = [
    ...new Set([
      ...holdings.map((fact) => fact.snapshotDate),
      ...baseline.map((point) => point.snapshotDate),
      ...declarations.map((fact) => fact.snapshotDate),
    ]),
  ]
    .filter((date) => date >= firstSelectionDate)
    .sort();

  const candidates = holdings
    .map((fact, originalIndex) => ({ fact, originalIndex }))
    .sort((left, right) =>
      compareText(left.fact.snapshotDate, right.fact.snapshotDate),
    )
    .values();
  const declarationIterator = [...declarations]
    .sort((left, right) => compareText(left.snapshotDate, right.snapshotDate))
    .values();
  let nextDeclaration = declarationIterator.next();
  const declaredCurrencies = new Set<NativeTotal["currency"]>();
  const reportedPoints = baseline.values();
  const selection: TimelineSelection = {
    groups: new Map(),
    candidatesByPosition: new Map(),
    changedPositionKeys: new Set(),
    current: new Map(),
    totals: new Map(),
  };
  const timeline = baseline.filter(
    (point) => point.snapshotDate < firstSelectionDate,
  );
  let nextCandidate = candidates.next();
  let nextReportedPoint = reportedPoints.next();
  let reportedTotals: NativeTotal[] = [];

  for (const snapshotDate of dates) {
    while (
      !nextDeclaration.done &&
      nextDeclaration.value.snapshotDate <= snapshotDate
    ) {
      retainTimelineBoundary(selection, nextDeclaration.value);
      if (!archivedAccountKeys.has(nextDeclaration.value.accountKey))
        declaredCurrencies.add(nextDeclaration.value.row.currency);
      nextDeclaration = declarationIterator.next();
    }
    while (
      !nextCandidate.done &&
      nextCandidate.value.fact.snapshotDate <= snapshotDate
    ) {
      retainTimelineCandidate(selection, nextCandidate.value);
      nextCandidate = candidates.next();
    }

    while (
      !nextReportedPoint.done &&
      nextReportedPoint.value.snapshotDate <= snapshotDate
    ) {
      reportedTotals = nextReportedPoint.value.totals;
      nextReportedPoint = reportedPoints.next();
    }

    updateTimelineSelection(
      selection,
      hasExplicitValuations,
      archivedAccountKeys,
    );
    const selectedTotals = [...selection.totals]
      .sort(([left], [right]) => compareText(left, right))
      .map(([currency, total]) => ({
        currency,
        investedAmount: total.investedAmount.toFixed(),
        currentValue: total.currentValue.toFixed(),
        pnlAmount: total.pnlAmount.toFixed(),
      }));

    timeline.push({
      snapshotDate,
      totals: hasExplicitValuations
        ? nativeTotals([...reportedTotals, ...selectedTotals])
        : nativeTotals([
            ...selectedTotals,
            ...[...declaredCurrencies].map((currency) => ({
              currency,
              investedAmount: "0",
              currentValue: "0",
              pnlAmount: "0",
            })),
          ]),
    });
  }

  return timeline;
}

interface TimelineCandidate {
  fact: HoldingFact;
  originalIndex: number;
}

interface TimelineSelectionGroup {
  completeSnapshot?: CompleteSnapshot;
  candidates: Map<string, TimelineCandidate>;
}

interface TimelineSelection {
  groups: Map<string, TimelineSelectionGroup>;
  candidatesByPosition: Map<string, Map<string, TimelineCandidate>>;
  changedPositionKeys: Set<string>;
  current: Map<string, TimelineCandidate>;
  totals: Map<NativeTotal["currency"], TimelineCurrencyTotal>;
}

type TimelineAmount = InstanceType<typeof FinancialDecimal>;

interface TimelineCurrencyTotal {
  count: number;
  investedAmount: TimelineAmount;
  currentValue: TimelineAmount;
  pnlAmount: TimelineAmount;
}

function retainTimelineCandidate(
  selection: TimelineSelection,
  candidate: TimelineCandidate,
) {
  const { fact } = candidate;
  const groupKey = selectionGroupKey(fact);
  const group = retainTimelineBoundary(selection, fact);
  if (
    group.completeSnapshot &&
    !isCurrentAtSnapshot(fact, group.completeSnapshot)
  )
    return;

  // Later complete snapshots only remove candidates. Keeping the best row
  // per position in each group retains alternatives from other source groups.
  const previous = group.candidates.get(fact.canonicalPositionKey);

  if (!previous || compareTimelineCandidates(candidate, previous) < 0) {
    const key = fact.canonicalPositionKey;
    group.candidates.set(key, candidate);
    const alternatives =
      selection.candidatesByPosition.get(key) ??
      new Map<string, TimelineCandidate>();
    alternatives.set(groupKey, candidate);
    selection.candidatesByPosition.set(key, alternatives);
    selection.changedPositionKeys.add(key);
  }
}

function retainTimelineBoundary(
  selection: TimelineSelection,
  fact: HoldingFact | SourceSnapshotFact,
) {
  const groupKey = selectionGroupKey(fact);
  let group = selection.groups.get(groupKey);
  if (!group) {
    group = { candidates: new Map() };
    selection.groups.set(groupKey, group);
  }

  const next: CompleteSnapshot = {
    date: fact.snapshotDate,
    priority: selectionPriority(fact),
    ...(fact.row.kind === "source_snapshot"
      ? {
          declaration: {
            provenance: fact.provenance,
            sourcePriority: fact.row.source.priority,
          },
        }
      : {}),
  };
  if (
    fact.row.source.completeness === "complete" &&
    isNewCompleteSnapshot(group.completeSnapshot, next)
  ) {
    group.completeSnapshot = next;
    for (const [key, previous] of group.candidates) {
      if (isCurrentAtSnapshot(previous.fact, next)) continue;

      group.candidates.delete(key);
      const alternatives = selection.candidatesByPosition.get(key);
      alternatives?.delete(groupKey);
      if (alternatives?.size === 0) selection.candidatesByPosition.delete(key);
      selection.changedPositionKeys.add(key);
    }
  }

  return group;
}

function updateTimelineSelection(
  selection: TimelineSelection,
  hasExplicitValuations: boolean,
  archivedAccountKeys: ReadonlySet<string>,
) {
  // Only a changed group candidate can alter a position's winner. Other source
  // groups stay indexed so a complete omission can reveal an older candidate.
  for (const key of selection.changedPositionKeys) {
    let winner: TimelineCandidate | undefined;
    for (const candidate of selection.candidatesByPosition.get(key)?.values() ??
      []) {
      if (!winner || compareTimelineCandidates(candidate, winner) < 0) {
        winner = candidate;
      }
    }

    const previous = selection.current.get(key);
    if (winner === previous) continue;

    if (
      previous &&
      !archivedAccountKeys.has(previous.fact.accountKey) &&
      (!hasExplicitValuations || previous.fact.row.policyId)
    ) {
      updateTimelineCurrencyTotal(selection.totals, previous.fact, -1);
    }

    if (winner) {
      selection.current.set(key, winner);
      if (
        !archivedAccountKeys.has(winner.fact.accountKey) &&
        (!hasExplicitValuations || winner.fact.row.policyId)
      ) {
        updateTimelineCurrencyTotal(selection.totals, winner.fact, 1);
      }
    } else {
      selection.current.delete(key);
    }
  }

  selection.changedPositionKeys.clear();
}

function updateTimelineCurrencyTotal(
  totals: TimelineSelection["totals"],
  fact: HoldingFact,
  direction: 1 | -1,
) {
  const currency = fact.row.currency;
  const previous = totals.get(currency) ?? {
    count: 0,
    investedAmount: new FinancialDecimal(0),
    currentValue: new FinancialDecimal(0),
    pnlAmount: new FinancialDecimal(0),
  };
  const count = previous.count + direction;

  if (count === 0) {
    totals.delete(currency);
    return;
  }

  // Reuse the native contribution rules, including missing P&L handling.
  // Counts distinguish an absent currency from selected rows whose sum is zero.
  for (const contribution of nativeTotals([fact.row])) {
    const adjust = (amount: TimelineAmount, change: string) =>
      direction === 1 ? amount.plus(change) : amount.minus(change);

    totals.set(currency, {
      count,
      investedAmount: adjust(
        previous.investedAmount,
        contribution.investedAmount,
      ),
      currentValue: adjust(previous.currentValue, contribution.currentValue),
      pnlAmount: adjust(previous.pnlAmount, contribution.pnlAmount),
    });
  }
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
