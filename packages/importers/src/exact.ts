import { adaptLegacyRow, financialFields } from "./exact-adapter";
import {
  exactNormalizedImportRowSchema,
  type ExactParseResult,
} from "./exact-types";
import {
  FinancialDecimal,
  canonicalizeDecimal,
  parseSourceDecimal,
} from "./numeric";
import { getSourceDecimals } from "./source-decimals";
import type { ParseResult } from "./types";

export function preserveParsedDecimals(result: ParseResult): ExactParseResult {
  const rows = result.rows.map((row) => {
    const exact = adaptLegacyRow(row);
    const values: Record<string, unknown> = { ...exact };
    const raw = getSourceDecimals(row);
    if (!raw)
      throw new Error("Parser did not retain its source financial cells");

    for (const field of financialFields) {
      const decimal = parseSourceDecimal(raw[field]);
      if (values[field] === undefined && decimal === undefined) continue;

      if (decimal !== undefined) {
        values[field] = decimal;
        exact.numericProvenance[field] = "source_decimal";
      } else if (typeof raw[field] === "number") {
        exact.numericProvenance[field] = "xlsx_float64";
      } else if (values[field] === "0") {
        exact.numericProvenance[field] = "default";
      }
    }

    if (row.sourceType === "nps_csv") {
      const contribution = parseSourceDecimal(raw.totalContribution);
      const withdrawal = parseSourceDecimal(raw.totalWithdrawal) ?? "0";
      if (contribution === undefined) {
        throw new Error(
          "NPS summary is missing exact contribution or withdrawal values",
        );
      }

      values.investedAmount = canonicalizeDecimal(
        new FinancialDecimal(contribution).minus(withdrawal).toFixed(),
      );
      exact.numericProvenance.investedAmount = "derived_decimal";
    }

    return exactNormalizedImportRowSchema.parse(values);
  });

  return {
    ...result,
    parserVersion: `${result.parserVersion}-decimal-v1`,
    rows,
  };
}
