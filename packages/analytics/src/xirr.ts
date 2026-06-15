export interface CashFlow {
  date: Date;
  amount: number;
}

export function xirr(cashFlows: CashFlow[], guess = 0.1): number | undefined {
  if (cashFlows.length < 2) return undefined;
  const hasPositive = cashFlows.some((flow) => flow.amount > 0);
  const hasNegative = cashFlows.some((flow) => flow.amount < 0);
  if (!hasPositive || !hasNegative) return undefined;

  const guesses = uniqueNumbers([guess, 0.1, 0, 0.25, 0.5, 1, -0.25, -0.5]);
  for (const initialGuess of guesses) {
    const solved = newtonXirr(cashFlows, initialGuess);
    if (solved !== undefined) return solved;
  }

  return bracketedXirr(cashFlows);
}

function newtonXirr(
  cashFlows: CashFlow[],
  initialGuess: number,
): number | undefined {
  let rate = initialGuess;
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

function bracketedXirr(cashFlows: CashFlow[]): number | undefined {
  const candidates = [
    -0.9999, -0.95, -0.9, -0.75, -0.5, -0.25, 0, 0.1, 0.25, 0.5, 1, 2, 5, 10,
    25, 50, 100,
  ];

  for (let index = 1; index < candidates.length; index += 1) {
    const left = candidates[index - 1];
    const right = candidates[index];
    if (left === undefined || right === undefined) continue;

    const leftValue = xnpv(left, cashFlows);
    const rightValue = xnpv(right, cashFlows);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
    if (Math.abs(leftValue) < 1e-7) return left;
    if (Math.abs(rightValue) < 1e-7) return right;
    if (Math.sign(leftValue) === Math.sign(rightValue)) continue;

    return bisectXirr(cashFlows, left, right);
  }

  return undefined;
}

function bisectXirr(
  cashFlows: CashFlow[],
  leftRate: number,
  rightRate: number,
): number | undefined {
  let left = leftRate;
  let right = rightRate;
  let leftValue = xnpv(left, cashFlows);

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (left + right) / 2;
    const midValue = xnpv(mid, cashFlows);
    if (!Number.isFinite(midValue)) return undefined;
    if (Math.abs(midValue) < 1e-7 || Math.abs(right - left) < 1e-7) {
      return mid;
    }
    if (Math.sign(leftValue) === Math.sign(midValue)) {
      left = mid;
      leftValue = midValue;
    } else {
      right = mid;
    }
  }

  return undefined;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
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
