import {
  exactNormalizedImportRowSchema,
  type ExactNormalizedImportRow,
  type ExactParseResult,
  type ImportSourceMetadata,
} from "./exact-types";
import { decimalFromLegacyNumber, decimalToDisplayNumber } from "./numeric";
import { legacySourceMetadata } from "./source";
import {
  normalizedImportRowSchema,
  type NormalizedImportRow,
  type ParseResult,
} from "./types";

export const financialFields = [
  "quantity",
  "price",
  "amount",
  "investedAmount",
  "currentValue",
  "pnlAmount",
] as const;

export function adaptLegacyRow(
  row: NormalizedImportRow,
  source = legacySourceMetadata(row),
): ExactNormalizedImportRow {
  const validated = normalizedImportRowSchema.parse(row);
  const values: Record<string, unknown> = { ...validated, source };
  const numericProvenance: Record<string, "legacy_float64"> = {};

  for (const field of financialFields) {
    const value = values[field];
    if (typeof value !== "number") continue;

    values[field] = decimalFromLegacyNumber(value);
    numericProvenance[field] = "legacy_float64";
  }

  return exactNormalizedImportRowSchema.parse({ ...values, numericProvenance });
}

export function adaptLegacyParseResult(
  result: ParseResult,
  sourceForRow: (
    row: NormalizedImportRow,
  ) => ImportSourceMetadata = legacySourceMetadata,
): ExactParseResult {
  return {
    ...result,
    rows: result.rows.map((row) => adaptLegacyRow(row, sourceForRow(row))),
  };
}

export function adaptExactParseResultToLegacy(
  result: ExactParseResult,
): ParseResult {
  return {
    ...result,
    rows: result.rows.map((row) => {
      const values: Record<string, unknown> = {
        ...exactNormalizedImportRowSchema.parse(row),
      };

      for (const field of financialFields) {
        const value = values[field];
        if (typeof value === "string")
          values[field] = decimalToDisplayNumber(value);
      }

      return normalizedImportRowSchema.parse(values);
    }),
  };
}
