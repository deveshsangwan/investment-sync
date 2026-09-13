import { z } from "zod";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";

export const provenanceSchema = z.object({
  batchId: z.string(),
  parserVersion: z.string(),
  sequence: z.number().int(),
  rowNumber: z.number().int(),
  fallbackDate: z.string(),
  legacyId: z.string().optional(),
});
const factSchema = z.object({
  row: exactNormalizedImportRowSchema,
  provenance: provenanceSchema,
});

export function decodeFact(json: string) {
  const value: unknown = JSON.parse(json);
  return factSchema.parse(value);
}
