import Decimal from "decimal.js";
import { z } from "zod";

// Source values retain all supplied digits. Arithmetic has enough precision for
// two bounded source values; persisted rounding belongs to the publication.
export const FinancialDecimal = Decimal.clone({
  precision: 256,
  rounding: Decimal.ROUND_HALF_EVEN,
});
export const canonicalDecimalSchema = z
  .string()
  .max(128)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/)
  .refine((value) => value !== "-0", "Negative zero is not canonical");
export type CanonicalDecimal = z.infer<typeof canonicalDecimalSchema>;

export function canonicalizeDecimal(value: string): CanonicalDecimal {
  if (
    value.length > 256 ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
  ) {
    throw new Error("Invalid decimal text");
  }

  const decimal = new FinancialDecimal(value);
  if (!decimal.isFinite() || Math.abs(decimal.e) > 127) {
    throw new Error("Decimal is outside the supported source range");
  }

  return canonicalDecimalSchema.parse(
    decimal.isZero() ? "0" : decimal.toFixed(),
  );
}

export function decimalFromLegacyNumber(value: number): CanonicalDecimal {
  if (!Number.isFinite(value)) {
    throw new Error("Financial values must be finite");
  }

  return canonicalizeDecimal(String(value));
}

export function decimalToDisplayNumber(value: CanonicalDecimal): number {
  const result = Number(canonicalDecimalSchema.parse(value));
  if (!Number.isFinite(result)) {
    throw new Error(
      "Financial value cannot be represented as a finite display number",
    );
  }

  return result;
}

export function parseSourceDecimal(
  value: unknown,
): CanonicalDecimal | undefined {
  if (typeof value !== "string") return undefined;

  const raw = value.replace(/rs\.?|inr/gi, "").replace(/[₹,$%\s\u00a0()]/g, "");
  if (!raw || raw === "-") return undefined;

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))
    return undefined;

  // Missing/non-numeric cells retain parser defaults. Recognized decimal
  // text outside the exact contract must never fall back to Float64.
  const result = canonicalizeDecimal(raw);
  return /\([^)]*\)/.test(value)
    ? canonicalizeDecimal(
        new FinancialDecimal(result).abs().negated().toFixed(),
      )
    : result;
}
