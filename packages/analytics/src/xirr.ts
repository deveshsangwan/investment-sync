export interface CashFlow {
  date: Date;
  amount: number;
}

export function xirr(cashFlows: CashFlow[], guess = 0.1): number | undefined {
  if (cashFlows.length < 2) return undefined;
  const hasPositive = cashFlows.some((flow) => flow.amount > 0);
  const hasNegative = cashFlows.some((flow) => flow.amount < 0);
  if (!hasPositive || !hasNegative) return undefined;

  let rate = guess;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const value = xnpv(rate, cashFlows);
    const derivative = xnpvDerivative(rate, cashFlows);
    if (Math.abs(derivative) < 1e-10) return undefined;
    const nextRate = rate - value / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= -0.999999) return undefined;
    if (Math.abs(nextRate - rate) < 1e-7) return nextRate;
    rate = nextRate;
  }

  return undefined;
}

function xnpv(rate: number, cashFlows: CashFlow[]): number {
  const firstDate = cashFlows[0]?.date.getTime() ?? 0;
  return cashFlows.reduce((total, flow) => {
    const years =
      (flow.date.getTime() - firstDate) / (365 * 24 * 60 * 60 * 1000);
    return total + flow.amount / Math.pow(1 + rate, years);
  }, 0);
}

function xnpvDerivative(rate: number, cashFlows: CashFlow[]): number {
  const firstDate = cashFlows[0]?.date.getTime() ?? 0;
  return cashFlows.reduce((total, flow) => {
    const years =
      (flow.date.getTime() - firstDate) / (365 * 24 * 60 * 60 * 1000);
    return total - (years * flow.amount) / Math.pow(1 + rate, years + 1);
  }, 0);
}
