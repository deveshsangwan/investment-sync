import {
  resolveAssetClassXirr,
  resolveHoldingXirr,
  summarizePerformance,
  summarizePortfolio,
  xirrByAssetClass,
} from "@investment-sync/analytics";
import type { AssetClass, Currency } from "@investment-sync/importers";
import { npsDetailsSchema } from "@investment-sync/importers/nps-details";
import {
  FinancialDecimal,
  decimalToDisplayNumber,
  roundDisplay,
} from "./numeric";
import { compareText } from "./ordering";
import type {
  HoldingFact,
  NativeTimelinePoint,
  NativeTotal,
  PortfolioProjection,
  PositionProjection,
  TransactionFact,
  ValuationQuote,
} from "./types";

export type PortfolioViewSelection =
  | { view: "all" }
  | { view: "overview" }
  | { view: "positions" }
  | { view: "summary" }
  | { view: "holdingDetail"; positionKey: string }
  | { view: "assetClassDetail"; assetClass: AssetClass };

export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote | undefined,
  selection: { view: "overview" },
): ReturnType<typeof portfolioOverview>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote | undefined,
  selection: { view: "positions" },
): ReturnType<typeof portfolioPositions>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote | undefined,
  selection: { view: "summary" },
): ReturnType<typeof portfolioSummary>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote | undefined,
  selection: { view: "holdingDetail"; positionKey: string },
): ReturnType<typeof selectedHoldingDetail>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote | undefined,
  selection: { view: "assetClassDetail"; assetClass: AssetClass },
): ReturnType<typeof assetClassDetail>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote?: ValuationQuote,
  selection?: { view: "all" },
): ReturnType<typeof allViews>;
export function valuePortfolioPublication(
  projection: PortfolioProjection,
  quote: ValuationQuote = { status: "unavailable" },
  selection: PortfolioViewSelection = { view: "all" },
) {
  switch (selection.view) {
    case "overview":
      return portfolioOverview(projection, quote);
    case "positions":
      return portfolioPositions(projection, quote);
    case "summary":
      return portfolioSummary(projection, quote);
    case "holdingDetail":
      return selectedHoldingDetail(projection, quote, selection.positionKey);
    case "assetClassDetail":
      return assetClassDetail(projection, quote, selection.assetClass);
    case "all":
      return allViews(projection, quote);
  }
}

function allViews(projection: PortfolioProjection, quote: ValuationQuote) {
  return {
    overview: portfolioOverview(projection, quote),
    positions: portfolioPositions(projection, quote),
    holdingDetails: projection.positions.map((position) => {
      const currencies = [
        position.holding.row.currency,
        ...currentCurrencies(projection),
      ];
      const rate = requiredRate(currencies, quote);

      return holdingDetail(position, portfolioSummary(projection, quote), rate);
    }),
    assetClassDetails: projection.assetClasses.map((asset) =>
      assetClassDetail(projection, quote, asset.assetClass),
    ),
  };
}

function requiredRate(currencies: Currency[], quote: ValuationQuote) {
  if (!currencies.includes("USD")) return undefined;
  if (quote.status === "unavailable")
    throw new Error("USD/INR exchange rate is unavailable");

  const rate = decimalToDisplayNumber(quote.rate);
  if (rate <= 0) throw new Error("Invalid USD/INR exchange rate");

  return rate;
}

function currentPositions(projection: PortfolioProjection) {
  return projection.positions.filter(
    (position) => position.status === "current",
  );
}

function currentCurrencies(projection: PortfolioProjection) {
  return currentPositions(projection).map(
    (position) => position.holding.row.currency,
  );
}

function portfolioSummary(
  projection: PortfolioProjection,
  quote: ValuationQuote,
) {
  const currencies = currentCurrencies(projection);
  const rate = requiredRate(currencies, quote);

  return summaryValues(projection, quote, currencies, rate);
}

function summaryValues(
  projection: PortfolioProjection,
  quote: ValuationQuote,
  currencies: Currency[],
  rate?: number,
) {
  const exchangeRates =
    currencies.includes("USD") && quote.status !== "unavailable"
      ? [
          {
            base: "USD" as const,
            quote: "INR" as const,
            rate: rate ?? 0,
            fetchedAt: quote.fetchedAt,
            provider: quote.provider,
            isStale: quote.status === "stale",
          },
        ]
      : [];

  return {
    ...summarizePortfolio(
      currentPositions(projection).map((position) =>
        performanceHolding(position.holding, rate),
      ),
    ),
    currency: "INR" as const,
    exchangeRates,
    asOfDate: projection.asOfDate,
  };
}

function portfolioPositions(
  projection: PortfolioProjection,
  quote: ValuationQuote,
) {
  const rate = requiredRate(
    projection.positions.map((position) => position.holding.row.currency),
    quote,
  );
  const holdings = (status: PositionProjection["status"]) =>
    projection.positions
      .filter((position) => position.status === status)
      .map((position) => publicHolding(position.holding, rate))
      .sort(byDateAndValue);

  return { current: holdings("current"), exited: holdings("exited") };
}

function portfolioOverview(
  projection: PortfolioProjection,
  quote: ValuationQuote,
) {
  const current = currentPositions(projection);
  const currencies = [
    ...currentCurrencies(projection),
    ...projection.cashFlows.map((fact) => fact.row.currency),
    ...projection.valuations.map((row) => row.currency),
  ];
  const timelineCurrencies = projection.hasExplicitValuations
    ? []
    : projection.timeline.flatMap((point) =>
        point.totals.map((total) => total.currency),
      );
  const rate = requiredRate([...currencies, ...timelineCurrencies], quote);
  const summary = summaryValues(projection, quote, currencies, rate);
  const performanceHoldings = current.map((position) =>
    performanceHolding(position.holding, rate),
  );
  const performance = {
    ...summarizePerformance({
      holdings: performanceHoldings,
      cashFlows: projection.cashFlows.map((fact) =>
        performanceCashFlow(fact, rate),
      ),
      valuations: projection.valuations.map((row) => ({
        date: new Date(row.valuationDate),
        investedAmount: convert(row.investedAmount, row.currency, rate),
        currentValue: convert(row.currentValue, row.currency, rate),
      })),
      asOfDate: new Date(projection.asOfDate ?? "1970-01-01"),
    }),
    byAssetClass: xirrByAssetClass({ holdings: performanceHoldings }),
    asOfDate: projection.asOfDate,
  };
  const historicalTimeline = projection.timeline.map((point) =>
    timelinePoint(point, rate, projection.hasExplicitValuations),
  );
  const last = historicalTimeline.at(-1);
  let timeline = historicalTimeline;
  if (summary.asOfDate && (!last || summary.asOfDate >= last.snapshotDate)) {
    const currentPoint = {
      snapshotDate: summary.asOfDate,
      investedAmount: summary.investedAmount,
      currentValue: summary.currentValue,
      pnlAmount: summary.pnlAmount,
      currency: "INR" as const,
    };
    timeline =
      last?.snapshotDate === summary.asOfDate
        ? [...historicalTimeline.slice(0, -1), currentPoint]
        : [...historicalTimeline, currentPoint];
  }

  return {
    holdings: current
      .map((position) => publicHolding(position.holding, rate))
      .sort(byDateAndValue),
    summary,
    performance,
    timeline,
  };
}

function selectedHoldingDetail(
  projection: PortfolioProjection,
  quote: ValuationQuote,
  positionKey: string,
) {
  const position = projection.positions.find(
    (candidate) => candidate.positionKey === positionKey,
  );
  if (!position) return null;

  const rate = requiredRate(
    [position.holding.row.currency, ...currentCurrencies(projection)],
    quote,
  );

  return holdingDetail(position, portfolioSummary(projection, quote), rate);
}

function assetClassDetail(
  projection: PortfolioProjection,
  quote: ValuationQuote,
  assetClass: AssetClass,
) {
  const current = currentPositions(projection);
  const exited = projection.positions.filter(
    (position) => position.status === "exited",
  );
  const asset = projection.assetClasses.find(
    (candidate) => candidate.assetClass === assetClass,
  ) ?? { assetClass, totals: [], timeline: [] };
  const assetPositions = projection.positions.filter(
    (position) => position.holding.row.assetClass === assetClass,
  );
  const currencies = [
    ...currentCurrencies(projection),
    ...assetPositions.flatMap((position) => [
      position.holding.row.currency,
      ...position.history.map((fact) => fact.row.currency),
    ]),
    ...asset.timeline.flatMap((point) =>
      point.totals.map((total) => total.currency),
    ),
  ];
  const rate = requiredRate(currencies, quote);
  const summary = portfolioSummary(projection, quote);
  const selected = current.filter(
    (position) => position.holding.row.assetClass === asset.assetClass,
  );
  const totals = convertedTotals(asset.totals, rate);
  const valuations = asset.timeline.map((point) => ({
    date: new Date(point.snapshotDate),
    ...convertedTotals(point.totals, rate),
  }));
  const resolved = resolveAssetClassXirr({
    holdings: selected.map((position) =>
      performanceHolding(position.holding, rate),
    ),
    valuations,
  });

  return {
    assetClass: asset.assetClass,
    holdings: selected
      .map((position) => {
        const holding = publicHolding(position.holding, rate);
        const xirr = positionXirr(position, rate, true);

        return {
          ...holding,
          sourceXirr: sourceXirr(position.holding),
          xirr: xirr.xirr,
          xirrDataQuality: xirr.dataQuality,
          weightInAssetClass: percent(
            holding.currentValueInInr,
            totals.currentValue,
          ),
        };
      })
      .sort((a, b) => b.currentValueInInr - a.currentValueInInr),
    summary: {
      investedAmount: roundDisplay(totals.investedAmount),
      currentValue: roundDisplay(totals.currentValue),
      pnlAmount: roundDisplay(totals.pnlAmount),
      pnlPercent: percent(totals.pnlAmount, totals.investedAmount),
      portfolioWeight: percent(totals.currentValue, summary.currentValue),
      holdingCount: selected.length,
      xirr: resolved.xirr,
      xirrDataQuality: resolved.dataQuality,
    },
    timeline: valuations.map((point) => ({
      snapshotDate: point.date.toISOString(),
      investedAmount: roundDisplay(point.investedAmount),
      currentValue: roundDisplay(point.currentValue),
    })),
    exitedHoldings: exited
      .filter(
        (position) => position.holding.row.assetClass === asset.assetClass,
      )
      .map((position) => ({
        ...publicHolding(position.holding, rate),
        sourceXirr: sourceXirr(position.holding),
      }))
      .sort((a, b) => compareText(b.snapshotDate, a.snapshotDate)),
  };
}

function holdingDetail(
  position: PositionProjection,
  summary: { currentValue: number; pnlAmount: number },
  rate?: number,
) {
  // Detail follows the latest raw snapshot, even when aggregate selection
  // excludes that snapshot from the current/exited position list.
  const latest = position.history.at(-1) ?? position.holding;
  const holding = publicHolding(latest, rate);
  const resolved = positionXirr({ ...position, holding: latest }, rate, false);

  return {
    positionKey: position.positionKey,
    holding: {
      ...holding,
      sourceXirr: sourceXirr(latest),
      xirr: resolved.xirr,
      xirrDataQuality: resolved.dataQuality,
      isCurrent:
        position.status === "current" &&
        latest.factKey === position.holding.factKey,
      portfolioWeight: percent(holding.currentValueInInr, summary.currentValue),
      pnlContribution: percent(holding.pnlAmountInInr ?? 0, summary.pnlAmount),
    },
    history: position.history.map((fact) => {
      const {
        isin: _isin,
        exchange: _exchange,
        ...point
      } = publicHolding(fact, rate);
      return {
        ...point,
        id: fact.provenance.legacyId ?? fact.factKey,
        pnlAmountInInr: point.pnlAmountInInr ?? 0,
      };
    }),
    npsDetails:
      npsDetailsSchema.safeParse(latest.row.metadata.npsDetails).data ?? null,
    transactions: position.transactions.map((fact) => ({
      id: fact.occurrenceKey,
      tradeDate: fact.row.tradeDate,
      type: fact.row.type,
      quantity: fact.row.quantity ?? null,
      price: fact.row.price ?? null,
      amount: fact.row.amount,
      currency: fact.row.currency,
      notes:
        typeof fact.row.metadata.notes === "string"
          ? fact.row.metadata.notes
          : null,
    })),
  };
}

function positionXirr(
  position: PositionProjection,
  rate: number | undefined,
  acrossAccounts: boolean,
) {
  const history = acrossAccounts
    ? position.instrumentHistory
    : position.history;
  const transactions = acrossAccounts
    ? position.instrumentTransactions
    : position.transactions;

  return resolveHoldingXirr({
    cashFlows: transactions.map((fact) => performanceCashFlow(fact, rate)),
    terminalValue: convert(
      position.holding.row.currentValue,
      position.holding.row.currency,
      rate,
    ),
    asOfDate: new Date(position.holding.snapshotDate),
    sourceXirr: sourceXirr(position.holding),
    valuations: history.map((fact) => ({
      date: new Date(fact.snapshotDate),
      investedAmount: convert(fact.row.investedAmount, fact.row.currency, rate),
      currentValue: convert(fact.row.currentValue, fact.row.currency, rate),
    })),
  });
}

function publicHolding(fact: HoldingFact, rate?: number) {
  const { row } = fact;
  return {
    id: fact.positionKey,
    accountId: fact.accountKey,
    instrumentId: fact.instrumentKey,
    snapshotDate: fact.snapshotDate,
    quantity: row.quantity ?? null,
    investedAmount: row.investedAmount,
    currentValue: row.currentValue,
    pnlAmount: row.pnlAmount ?? null,
    pnlPercent: row.pnlPercent === undefined ? null : String(row.pnlPercent),
    currency: row.currency,
    assetClass: row.assetClass,
    sourceSheet: row.source.group,
    accountName: row.accountName,
    provider: row.provider,
    instrumentName: row.instrumentName,
    symbol: row.symbol ?? null,
    isin: row.isin ?? null,
    exchange:
      typeof row.metadata.exchange === "string" ? row.metadata.exchange : null,
    currentValueInInr: convert(row.currentValue, row.currency, rate),
    investedAmountInInr: convert(row.investedAmount, row.currency, rate),
    pnlAmountInInr:
      row.pnlAmount === undefined
        ? null
        : convert(row.pnlAmount, row.currency, rate),
  };
}

function performanceHolding(fact: HoldingFact, rate?: number) {
  return {
    assetClass: fact.row.assetClass,
    investedAmount: convert(fact.row.investedAmount, fact.row.currency, rate),
    currentValue: convert(fact.row.currentValue, fact.row.currency, rate),
    sourceXirr: sourceXirr(fact),
  };
}

function performanceCashFlow(fact: TransactionFact, rate?: number) {
  return {
    date: new Date(fact.row.tradeDate),
    amount: convert(fact.row.amount, fact.row.currency, rate),
    type: fact.row.type,
  };
}

function sourceXirr(fact: HoldingFact): number | undefined {
  const value = fact.row.metadata.xirr;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function convert(value: string, currency: Currency, rate?: number): number {
  if (currency === "INR") return decimalToDisplayNumber(value);
  if (currency === "USD" && rate)
    return new FinancialDecimal(value).times(rate).toNumber();

  return 0;
}

function convertedTotals(totals: NativeTotal[], rate?: number) {
  return totals.reduce(
    (sum, total) => ({
      investedAmount:
        sum.investedAmount +
        convert(total.investedAmount, total.currency, rate),
      currentValue:
        sum.currentValue + convert(total.currentValue, total.currency, rate),
      pnlAmount: sum.pnlAmount + convert(total.pnlAmount, total.currency, rate),
    }),
    { investedAmount: 0, currentValue: 0, pnlAmount: 0 },
  );
}

function timelinePoint(
  point: NativeTimelinePoint,
  rate: number | undefined,
  hasPnl: boolean,
) {
  const totals = convertedTotals(point.totals, rate);
  return {
    snapshotDate: point.snapshotDate,
    investedAmount: roundDisplay(totals.investedAmount),
    currentValue: roundDisplay(totals.currentValue),
    ...(hasPnl ? { pnlAmount: roundDisplay(totals.pnlAmount) } : {}),
    currency: "INR" as const,
  };
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : roundDisplay((value / total) * 100);
}

function byDateAndValue(
  left: { snapshotDate: string; currentValueInInr: number },
  right: { snapshotDate: string; currentValueInInr: number },
): number {
  return (
    compareText(right.snapshotDate, left.snapshotDate) ||
    right.currentValueInInr - left.currentValueInInr
  );
}

export type PortfolioViews = ReturnType<typeof valuePortfolioPublication>;
export type PublicHolding = PortfolioViews["positions"]["current"][number];
