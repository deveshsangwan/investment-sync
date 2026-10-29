import { describe, expect, it } from "vitest";
import { exactNormalizedHoldingRowSchema } from "@investment-sync/importers/exact-types";
import {
  accountKey,
  canonicalPositionKey,
  instrumentKey,
  positionKey,
  sourceGroupKey,
} from "./identity";
import {
  nativeTotals,
  selectPositions,
  snapshotTimeline,
  timelineWithManualPolicies,
} from "./sourceSnapshots";
import type {
  HoldingFact,
  HoldingRow,
  ImportProvenance,
  NativeTimelinePoint,
} from "./types";

const partialSource = {
  group: "broker-one",
  completeness: "partial",
  granularity: "instrument",
  priority: 0,
} satisfies HoldingRow["source"];

function holding(
  overrides: Partial<HoldingRow> = {},
  provenanceOverrides: Partial<ImportProvenance> = {},
): HoldingFact {
  const row = exactNormalizedHoldingRowSchema.parse({
    kind: "holding",
    sourceType: "tickertape_stock_csv",
    sourceDate: "2025-01-01",
    accountName: "Stocks",
    provider: "Broker",
    instrumentName: "SHARED",
    symbol: "SHARED",
    assetClass: "indian_stock",
    currency: "INR",
    investedAmount: "100",
    currentValue: "120",
    pnlAmount: "20",
    source: partialSource,
    numericProvenance: {},
    metadata: {},
    ...overrides,
  });
  const provenance = {
    batchId: JSON.stringify([
      row.source.group,
      row.sourceDate,
      row.instrumentName,
      row.currentValue,
    ]),
    parserVersion: "test-v1",
    sequence: 1,
    rowNumber: 1,
    fallbackDate: "2025-01-01",
    ...provenanceOverrides,
  };

  return {
    row,
    provenance,
    accountKey: accountKey(row),
    instrumentKey: instrumentKey(row),
    positionKey: positionKey(row),
    canonicalPositionKey: canonicalPositionKey(row),
    sourceGroupKey: sourceGroupKey(row),
    snapshotDate: row.sourceDate ?? provenance.fallbackDate,
    factKey: JSON.stringify([provenance.batchId, provenance.rowNumber]),
  };
}

function manualPolicy(sourceDate: string, currentValue = "20") {
  return holding({
    policyId: "policy-one",
    sourceType: "manual_snapshot",
    sourceDate,
    accountName: "Insurer",
    provider: "Insurer",
    instrumentName: "Policy",
    symbol: undefined,
    assetClass: "ulip",
    investedAmount: "10",
    currentValue,
    pnlAmount: "10",
    source: { ...partialSource, group: "manual-policy:policy-one" },
  });
}

// The existing selector is the behavioral reference. Its full-history reads
// exercise a different path than the timeline's retained-candidate traversal.
function referenceTimeline(
  holdings: HoldingFact[],
  baseline: NativeTimelinePoint[],
  hasExplicitValuations = false,
) {
  const firstManualDate = holdings
    .filter(
      (fact) => fact.row.policyId && fact.row.sourceType === "manual_snapshot",
    )
    .map((fact) => fact.snapshotDate)
    .sort()[0];

  if (!firstManualDate) return baseline;

  const dates = [
    ...new Set([
      ...holdings.map((fact) => fact.snapshotDate),
      ...baseline.map((point) => point.snapshotDate),
    ]),
  ]
    .filter((date) => date >= firstManualDate)
    .sort();

  return [
    ...baseline.filter((point) => point.snapshotDate < firstManualDate),
    ...dates.map((snapshotDate) => {
      const current = selectPositions(
        holdings.filter((fact) => fact.snapshotDate <= snapshotDate),
      ).current;
      const reportedTotals =
        baseline.filter((point) => point.snapshotDate <= snapshotDate).at(-1)
          ?.totals ?? [];
      const rows = hasExplicitValuations
        ? [
            ...reportedTotals,
            ...current
              .filter((fact) => fact.row.policyId)
              .map((fact) => fact.row),
          ]
        : current.map((fact) => fact.row);

      return { snapshotDate, totals: nativeTotals(rows) };
    }),
  ];
}

describe("native P&L totals", () => {
  it.each([
    ["125", "25"],
    ["75", "-25"],
    ["100", "0"],
  ])("derives absent P&L for current value %s", (currentValue, pnlAmount) => {
    expect(
      nativeTotals([{ currency: "INR", investedAmount: "100", currentValue }]),
    ).toEqual([
      { currency: "INR", investedAmount: "100", currentValue, pnlAmount },
    ]);
  });

  it("subtracts decimals exactly before summing, including beyond Float64 precision", () => {
    expect(
      nativeTotals([
        {
          currency: "INR",
          investedAmount: "9007199254740993.1",
          currentValue: "9007199254740993.3",
        },
        { currency: "INR", investedAmount: "0.2", currentValue: "0.1" },
      ]),
    ).toEqual([
      {
        currency: "INR",
        investedAmount: "9007199254740993.3",
        currentValue: "9007199254740993.4",
        pnlAmount: "0.1",
      },
    ]);
  });

  it("preserves reported values including zero while deriving missing values per currency", () => {
    expect(
      nativeTotals([
        { currency: "INR", investedAmount: "100", currentValue: "125" },
        {
          currency: "INR",
          investedAmount: "100",
          currentValue: "130",
          pnlAmount: "0",
        },
        {
          currency: "INR",
          investedAmount: "100",
          currentValue: "140",
          pnlAmount: "7.25",
        },
        { currency: "USD", investedAmount: "10.1", currentValue: "9.9" },
        {
          currency: "USD",
          investedAmount: "10",
          currentValue: "12",
          pnlAmount: "1.5",
        },
      ]),
    ).toEqual([
      {
        currency: "INR",
        investedAmount: "300",
        currentValue: "395",
        pnlAmount: "32.25",
      },
      {
        currency: "USD",
        investedAmount: "20.1",
        currentValue: "21.9",
        pnlAmount: "1.3",
      },
    ]);
  });
});

describe("manual policy timelines", () => {
  it("retains the original baseline until the first manual date", () => {
    const imported = holding();
    const baseline = snapshotTimeline([imported]);

    expect(timelineWithManualPolicies([imported], baseline)).toBe(baseline);

    const holdings = [imported, manualPolicy("2025-01-03")];
    const timeline = timelineWithManualPolicies(holdings, baseline);

    expect(timeline[0]).toBe(baseline[0]);
    expect(timeline.map((point) => point.totals[0]?.currentValue)).toEqual([
      "120",
      "140",
    ]);
    expect(timeline).toEqual(referenceTimeline(holdings, baseline));
  });

  it("restores competing source candidates after complete omissions and carries partial updates", () => {
    const complete = { ...partialSource, completeness: "complete" as const };
    const holdings = [
      holding({ currentValue: "100", source: complete }, { legacyId: "z" }),
      holding({
        currentValue: "90",
        source: { ...partialSource, group: "broker-two" },
      }),
      manualPolicy("2025-01-02"),
      holding({
        sourceDate: "2025-01-03",
        instrumentName: "OTHER",
        symbol: "OTHER",
        currentValue: "70",
        source: complete,
      }),
      holding({
        sourceDate: "2025-01-04",
        currentValue: "130",
      }),
    ];
    const baseline = snapshotTimeline(holdings);
    const timeline = timelineWithManualPolicies(holdings, baseline);

    expect(timeline.map((point) => point.totals[0]?.currentValue)).toEqual([
      "190",
      "120",
      "180",
      "220",
    ]);
    expect(timeline).toEqual(referenceTimeline(holdings, baseline));
    expect(
      timelineWithManualPolicies([...holdings].reverse(), baseline),
    ).toEqual(referenceTimeline([...holdings].reverse(), baseline));
  });

  it("honors workbook and Vested group aliases, dates, and same-date priority", () => {
    const workbook = {
      sourceType: "investment_portfolio_xlsx",
      accountName: "US Stocks",
      provider: "Manual Workbook",
      assetClass: "us_stock",
      currency: "USD",
      metadata: { sourceSheet: "US stocks" },
      source: { ...partialSource, completeness: "complete" },
    } satisfies Partial<HoldingRow>;
    const vested = {
      ...workbook,
      sourceType: "vested_drivewealth_xlsx",
      provider: "Vested / DriveWealth",
      metadata: {},
      source: { ...workbook.source, group: "vested" },
    } satisfies Partial<HoldingRow>;
    const holdings = [
      holding({ ...workbook, currentValue: "10" }),
      holding({
        ...workbook,
        instrumentName: "OMITTED",
        symbol: "OMITTED",
        currentValue: "11",
      }),
      manualPolicy("2025-01-01"),
      holding({ ...vested, currentValue: "20" }),
      holding({
        ...workbook,
        instrumentName: "LOW PRIORITY",
        symbol: "LOW",
        currentValue: "30",
        source: { ...workbook.source, completeness: "partial" },
      }),
      holding({
        ...workbook,
        sourceDate: "2025-01-02",
        instrumentName: "OTHER",
        symbol: "OTHER",
        currentValue: "40",
      }),
      holding({
        ...vested,
        sourceDate: "2025-01-02",
        currentValue: "50",
        source: { ...vested.source, completeness: "partial" },
      }),
    ];
    const baseline = snapshotTimeline(holdings);
    const timeline = timelineWithManualPolicies(holdings, baseline);

    expect(
      timeline.map(
        (point) =>
          point.totals.find((total) => total.currency === "USD")?.currentValue,
      ),
    ).toEqual(["20", "90"]);
    expect(timeline).toEqual(referenceTimeline(holdings, baseline));
    expect(
      timelineWithManualPolicies([...holdings].reverse(), baseline),
    ).toEqual(referenceTimeline([...holdings].reverse(), baseline));
  });

  it("preserves canonical name and key tie breaks and stable input order for exact ties", () => {
    const holdings = [
      holding(
        {
          sourceDate: "2025-01-03",
          currentValue: "90",
          source: { ...partialSource, group: "broker-two" },
        },
        { batchId: "same", legacyId: "same" },
      ),
      holding(
        { sourceDate: "2025-01-03", currentValue: "80" },
        { batchId: "same", legacyId: "same" },
      ),
      holding({ currentValue: "70" }),
      manualPolicy("2025-01-02"),
      holding(
        { sourceDate: "2025-01-04", currentValue: "100" },
        { legacyId: "a" },
      ),
      holding(
        { sourceDate: "2025-01-04", currentValue: "110" },
        { legacyId: "z" },
      ),
      holding({
        sourceDate: "2025-01-05",
        instrumentName: "Z name",
        currentValue: "120",
      }),
      holding({
        sourceDate: "2025-01-05",
        instrumentName: "A name",
        currentValue: "130",
      }),
    ];
    const baseline = snapshotTimeline(holdings);
    const timeline = timelineWithManualPolicies(holdings, baseline);

    expect(timeline.map((point) => point.totals[0]?.currentValue)).toEqual([
      "70",
      "90",
      "110",
      "130",
      "150",
    ]);
    expect(timeline).toEqual(referenceTimeline(holdings, baseline));
    expect(
      timelineWithManualPolicies([...holdings].reverse(), baseline),
    ).toEqual(referenceTimeline([...holdings].reverse(), baseline));
  });

  it("carries explicit reported valuations while adding exact manual values only after their dates", () => {
    const baseline: NativeTimelinePoint[] = [
      {
        snapshotDate: "2025-01-01",
        totals: nativeTotals([
          { currency: "INR", investedAmount: "1000", currentValue: "1100" },
          { currency: "USD", investedAmount: "10", currentValue: "11" },
        ]),
      },
      {
        snapshotDate: "2025-01-03",
        totals: nativeTotals([
          { currency: "INR", investedAmount: "1000", currentValue: "1200" },
          { currency: "USD", investedAmount: "10", currentValue: "12" },
        ]),
      },
      {
        snapshotDate: "2025-01-06",
        totals: nativeTotals([
          { currency: "INR", investedAmount: "1000", currentValue: "1300" },
          { currency: "USD", investedAmount: "10", currentValue: "13" },
        ]),
      },
    ];
    const holdings = [
      holding({ currentValue: "999" }),
      manualPolicy("2025-01-02", "0.1234"),
      manualPolicy("2025-01-04", "0.5678"),
      holding({ sourceDate: "2025-01-05", currentValue: "888" }),
    ];
    const timeline = timelineWithManualPolicies(holdings, baseline, true);

    expect(
      timeline.map(
        (point) =>
          point.totals.find((total) => total.currency === "INR")?.currentValue,
      ),
    ).toEqual([
      "1100",
      "1100.1234",
      "1200.1234",
      "1200.5678",
      "1200.5678",
      "1300.5678",
    ]);
    expect(timeline).toEqual(referenceTimeline(holdings, baseline, true));
  });

  it("matches full-history selection for mixed complete and partial histories in different input orders", () => {
    const histories = Array.from({ length: 180 }, (_, index) => {
      const sourceDate = new Date(Date.UTC(2025, 0, 1 + Math.floor(index / 6)))
        .toISOString()
        .slice(0, 10);

      if (index % 7 === 0) {
        return manualPolicy(sourceDate, `${index}.1234`);
      }

      const symbol = `STOCK-${index % 8}`;

      return holding(
        {
          sourceDate,
          instrumentName: symbol,
          symbol,
          currentValue: `${index}.5678`,
          source: {
            ...partialSource,
            group: `broker-${index % 4}`,
            completeness: index % 5 === 0 ? "complete" : "partial",
          },
        },
        { batchId: `batch-${index}`, sequence: index },
      );
    });

    for (const holdings of [
      histories,
      [...histories].reverse(),
      [
        ...histories.filter((_, index) => index % 2),
        ...histories.filter((_, index) => index % 2 === 0),
      ],
    ]) {
      const baseline = snapshotTimeline(holdings);

      expect(timelineWithManualPolicies(holdings, baseline)).toEqual(
        referenceTimeline(holdings, baseline),
      );
    }
  });
});
