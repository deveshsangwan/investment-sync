import { z } from "zod";
import { canonicalDecimalSchema } from "./numeric";
import {
  normalizedHoldingRowSchema,
  normalizedTransactionRowSchema,
  normalizedValuationRowSchema,
  importSourceTypeSchema,
} from "./types";

export const importSourceMetadataSchema = z.object({
  group: z.string(),
  completeness: z.enum(["complete", "partial"]),
  granularity: z.enum(["instrument", "asset_class", "portfolio"]),
  priority: z.number().int(),
});
export type ImportSourceMetadata = z.infer<typeof importSourceMetadataSchema>;

export const numericProvenanceSchema = z.enum([
  "source_decimal",
  "persisted_decimal",
  "legacy_float64",
  "xlsx_float64",
  "derived_decimal",
  "default",
]);
const exactFields = {
  source: importSourceMetadataSchema,
  numericProvenance: z.record(numericProvenanceSchema),
};
export const exactNormalizedHoldingRowSchema =
  normalizedHoldingRowSchema.extend({
    ...exactFields,
    quantity: canonicalDecimalSchema.optional(),
    investedAmount: canonicalDecimalSchema,
    currentValue: canonicalDecimalSchema,
    pnlAmount: canonicalDecimalSchema.optional(),
  });
export const exactNormalizedTransactionRowSchema =
  normalizedTransactionRowSchema.extend({
    ...exactFields,
    quantity: canonicalDecimalSchema.optional(),
    price: canonicalDecimalSchema.optional(),
    amount: canonicalDecimalSchema,
  });
export const exactNormalizedValuationRowSchema =
  normalizedValuationRowSchema.extend({
    ...exactFields,
    investedAmount: canonicalDecimalSchema,
    currentValue: canonicalDecimalSchema,
    pnlAmount: canonicalDecimalSchema.optional(),
  });
export const exactNormalizedImportRowSchema = z.discriminatedUnion("kind", [
  exactNormalizedHoldingRowSchema,
  exactNormalizedTransactionRowSchema,
  exactNormalizedValuationRowSchema,
]);
export type ExactNormalizedHoldingRow = z.infer<
  typeof exactNormalizedHoldingRowSchema
>;
export type ExactNormalizedTransactionRow = z.infer<
  typeof exactNormalizedTransactionRowSchema
>;
export type ExactNormalizedValuationRow = z.infer<
  typeof exactNormalizedValuationRowSchema
>;
export type ExactNormalizedImportRow = z.infer<
  typeof exactNormalizedImportRowSchema
>;
export const exactParseResultSchema = z.object({
  sourceType: importSourceTypeSchema,
  parserVersion: z.string().min(1),
  rows: z.array(exactNormalizedImportRowSchema),
  warnings: z.array(z.string()),
});
export type ExactParseResult = z.infer<typeof exactParseResultSchema>;
