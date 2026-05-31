export interface HoldingInput {
  assetClass: string;
  accountName?: string;
  investedAmount: number;
  currentValue: number;
  pnlAmount?: number | null;
}

export interface PortfolioSummary {
  investedAmount: number;
  currentValue: number;
  pnlAmount: number;
  pnlPercent: number;
  allocationByAssetClass: Array<{
    assetClass: string;
    currentValue: number;
    weight: number;
  }>;
}

export function summarizePortfolio(holdings: HoldingInput[]): PortfolioSummary {
  const investedAmount = roundMoney(
    sum(holdings.map((holding) => holding.investedAmount)),
  );
  const currentValue = roundMoney(
    sum(holdings.map((holding) => holding.currentValue)),
  );
  const pnlAmount = roundMoney(currentValue - investedAmount);
  const pnlPercent =
    investedAmount === 0 ? 0 : roundPercent((pnlAmount / investedAmount) * 100);

  const byAssetClass = new Map<string, number>();
  for (const holding of holdings) {
    byAssetClass.set(
      holding.assetClass,
      (byAssetClass.get(holding.assetClass) ?? 0) + holding.currentValue,
    );
  }

  const allocationByAssetClass = [...byAssetClass.entries()]
    .map(([assetClass, value]) => ({
      assetClass,
      currentValue: roundMoney(value),
      weight:
        currentValue === 0 ? 0 : roundPercent((value / currentValue) * 100),
    }))
    .sort((a, b) => b.currentValue - a.currentValue);

  return {
    investedAmount,
    currentValue,
    pnlAmount,
    pnlPercent,
    allocationByAssetClass,
  };
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
