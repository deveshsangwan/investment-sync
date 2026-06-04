import { xirr, type CashFlow } from "./xirr";

export type PerformanceDataQuality =
  | "exact"
  | "source_provided"
  | "estimated"
  | "insufficient_data";

export interface PerformanceCashFlowInput {
  date: Date;
  amount: number;
  type:
    | "buy"
    | "sell"
    | "dividend"
    | "fee"
    | "transfer"
    | "contribution"
    | "redemption";
}

export interface PerformanceHoldingInput {
  assetClass: string;
  currentValue: number;
  investedAmount: number;
  sourceXirr?: number;
}

export interface PerformanceValuationInput {
  date: Date;
  investedAmount: number;
  currentValue: number;
}

export interface PortfolioPerformanceSummary {
  xirr?: number;
  dataQuality: PerformanceDataQuality;
  absoluteReturnPercent: number;
  cagr?: number;
  cashFlowCount: number;
  valuationCount: number;
  sourceXirrCoveragePercent: number;
}

export function summarizePerformance(input: {
  cashFlows: PerformanceCashFlowInput[];
  holdings: PerformanceHoldingInput[];
  valuations: PerformanceValuationInput[];
  asOfDate: Date;
}): PortfolioPerformanceSummary {
  const terminalValue = sum(
    input.holdings.map((holding) => holding.currentValue),
  );
  const investedAmount = sum(
    input.holdings.map((holding) => holding.investedAmount),
  );
  const absoluteReturnPercent =
    investedAmount === 0
      ? 0
      : roundPercent(((terminalValue - investedAmount) / investedAmount) * 100);

  const exactXirr = xirrFromCashFlows(
    input.cashFlows,
    terminalValue,
    input.asOfDate,
  );
  if (exactXirr !== undefined) {
    return {
      xirr: roundPercent(exactXirr * 100),
      dataQuality: "exact",
      absoluteReturnPercent,
      cagr: cagrFromValuations(input.valuations),
      cashFlowCount: input.cashFlows.length,
      valuationCount: input.valuations.length,
      sourceXirrCoveragePercent: sourceXirrCoverage(input.holdings),
    };
  }

  const weightedSourceXirr = weightedAverageSourceXirr(input.holdings);
  if (weightedSourceXirr !== undefined) {
    return {
      xirr: roundPercent(weightedSourceXirr),
      dataQuality: "source_provided",
      absoluteReturnPercent,
      cagr: cagrFromValuations(input.valuations),
      cashFlowCount: input.cashFlows.length,
      valuationCount: input.valuations.length,
      sourceXirrCoveragePercent: sourceXirrCoverage(input.holdings),
    };
  }

  const estimatedXirr = xirrFromValuationDeltas(input.valuations);
  return {
    xirr:
      estimatedXirr === undefined
        ? undefined
        : roundPercent(estimatedXirr * 100),
    dataQuality:
      estimatedXirr === undefined ? "insufficient_data" : "estimated",
    absoluteReturnPercent,
    cagr: cagrFromValuations(input.valuations),
    cashFlowCount: input.cashFlows.length,
    valuationCount: input.valuations.length,
    sourceXirrCoveragePercent: sourceXirrCoverage(input.holdings),
  };
}

export interface ResolvedXirr {
  xirr?: number;
  dataQuality: PerformanceDataQuality;
}

export function resolveHoldingXirr(input: {
  cashFlows: PerformanceCashFlowInput[];
  terminalValue: number;
  asOfDate: Date;
  sourceXirr?: number;
  valuations: PerformanceValuationInput[];
}): ResolvedXirr {
  const exactRate = xirrFromCashFlows(
    input.cashFlows,
    input.terminalValue,
    input.asOfDate,
  );
  if (exactRate !== undefined) {
    return {
      xirr: roundPercent(exactRate * 100),
      dataQuality: "exact",
    };
  }

  if (
    input.sourceXirr !== undefined &&
    Number.isFinite(input.sourceXirr)
  ) {
    return {
      xirr: roundPercent(input.sourceXirr),
      dataQuality: "source_provided",
    };
  }

  const estimatedRate = xirrFromValuationDeltas(input.valuations);
  if (estimatedRate === undefined) {
    return { dataQuality: "insufficient_data" };
  }

  return {
    xirr: roundPercent(estimatedRate * 100),
    dataQuality: "estimated",
  };
}

export function resolveAssetClassXirr(input: {
  holdings: PerformanceHoldingInput[];
  valuations: PerformanceValuationInput[];
}): ResolvedXirr {
  const sourceXirr = weightedAverageSourceXirr(input.holdings);
  if (sourceXirr !== undefined) {
    return {
      xirr: roundPercent(sourceXirr),
      dataQuality: "source_provided",
    };
  }

  const estimatedRate = xirrFromValuationDeltas(input.valuations);
  if (estimatedRate === undefined) {
    return { dataQuality: "insufficient_data" };
  }

  return {
    xirr: roundPercent(estimatedRate * 100),
    dataQuality: "estimated",
  };
}

export function xirrByAssetClass(input: {
  holdings: PerformanceHoldingInput[];
  valuationsByAssetClass?: Record<string, PerformanceValuationInput[]>;
}): Array<{
  assetClass: string;
  xirr?: number;
  dataQuality: PerformanceDataQuality;
  currentValue: number;
  investedAmount: number;
}> {
  const groups = new Map<string, PerformanceHoldingInput[]>();
  for (const holding of input.holdings) {
    groups.set(holding.assetClass, [
      ...(groups.get(holding.assetClass) ?? []),
      holding,
    ]);
  }

  return [...groups.entries()]
    .map(([assetClass, holdings]) => {
      const resolved = resolveAssetClassXirr({
        holdings,
        valuations: input.valuationsByAssetClass?.[assetClass] ?? [],
      });
      return {
        assetClass,
        xirr: resolved.xirr,
        dataQuality: resolved.dataQuality,
        currentValue: roundMoney(
          sum(holdings.map((holding) => holding.currentValue)),
        ),
        investedAmount: roundMoney(
          sum(holdings.map((holding) => holding.investedAmount)),
        ),
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);
}

export function xirrFromCashFlows(
  flows: PerformanceCashFlowInput[],
  terminalValue: number,
  asOfDate: Date,
): number | undefined {
  if (flows.length === 0 || terminalValue <= 0) return undefined;
  const signedFlows: CashFlow[] = flows.map((flow) => ({
    date: flow.date,
    amount: signedCashFlowAmount(flow),
  }));
  signedFlows.push({ date: asOfDate, amount: terminalValue });
  return xirr(signedFlows.sort((a, b) => a.date.getTime() - b.date.getTime()));
}

export function xirrFromValuationDeltas(
  valuations: PerformanceValuationInput[],
): number | undefined {
  if (valuations.length < 2) return undefined;
  const sorted = [...valuations].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.investedAmount <= 0 || last.currentValue <= 0) {
    return undefined;
  }

  const flows: CashFlow[] = [
    { date: first.date, amount: -first.investedAmount },
  ];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    const investedDelta = current.investedAmount - previous.investedAmount;
    if (investedDelta > 0) {
      flows.push({ date: current.date, amount: -investedDelta });
    } else if (investedDelta < 0) {
      flows.push({ date: current.date, amount: Math.abs(investedDelta) });
    }
  }
  flows.push({ date: last.date, amount: last.currentValue });
  return xirr(flows);
}

function cagrFromValuations(
  valuations: PerformanceValuationInput[],
): number | undefined {
  if (valuations.length < 2) return undefined;
  const sorted = [...valuations].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || first.currentValue <= 0 || last.currentValue <= 0) {
    return undefined;
  }
  const years =
    (last.date.getTime() - first.date.getTime()) / (365 * 24 * 60 * 60 * 1000);
  if (years <= 0) return undefined;
  return roundPercent(
    (Math.pow(last.currentValue / first.currentValue, 1 / years) - 1) * 100,
  );
}

function weightedAverageSourceXirr(
  holdings: PerformanceHoldingInput[],
): number | undefined {
  const withXirr = holdings.filter(
    (holding) =>
      holding.sourceXirr !== undefined && Number.isFinite(holding.sourceXirr),
  );
  const weight = sum(withXirr.map((holding) => holding.currentValue));
  if (weight <= 0) return undefined;
  return (
    withXirr.reduce(
      (total, holding) =>
        total + (holding.sourceXirr ?? 0) * holding.currentValue,
      0,
    ) / weight
  );
}

function sourceXirrCoverage(holdings: PerformanceHoldingInput[]): number {
  const total = sum(holdings.map((holding) => holding.currentValue));
  if (total <= 0) return 0;
  const covered = sum(
    holdings
      .filter((holding) => holding.sourceXirr !== undefined)
      .map((holding) => holding.currentValue),
  );
  return roundPercent((covered / total) * 100);
}

function signedCashFlowAmount(flow: PerformanceCashFlowInput): number {
  if (["sell", "dividend", "redemption"].includes(flow.type)) {
    return Math.abs(flow.amount);
  }
  if (flow.type === "transfer") return flow.amount;
  return -Math.abs(flow.amount);
}

function sum(values: number[]): number {
  return values.reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}
