import {
  canonicalizeDecimal,
  decimalToDisplayNumber as toDisplay,
  FinancialDecimal,
} from "@investment-sync/importers/numeric";
export { FinancialDecimal };

export function canonicalDecimal(value: string): string {
  return canonicalizeDecimal(value);
}

export function decimalToDisplayNumber(value: string): number {
  return toDisplay(canonicalDecimal(value));
}

export function sumDecimals(values: string[]): string {
  return values
    .reduce((sum, value) => sum.plus(value), new FinancialDecimal(0))
    .toFixed();
}

export function subtractDecimals(left: string, right: string): string {
  return new FinancialDecimal(left).minus(right).toFixed();
}

export function roundDisplay(value: number): number {
  return Math.round(value * 100) / 100;
}
