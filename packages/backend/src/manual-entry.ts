import { z } from "zod";
import { isoDateSchema } from "@investment-sync/importers/types";
import { canonicalizeDecimal } from "@investment-sync/importers/numeric";

const amountSchema = z
  .string()
  .trim()
  .max(32)
  .regex(
    /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/,
    "Enter a positive amount or zero, with up to two decimal places.",
  )
  .transform((value) => canonicalizeDecimal(value.replaceAll(",", "")))
  .refine((value) => Number(value) < 1_000_000_000_000, "Amount is too large.");

export const manualPolicyValuesSchema = z.object({
  investedAmount: amountSchema,
  currentValue: amountSchema,
  sourceDate: isoDateSchema,
});

export const manualPolicyInputSchema = manualPolicyValuesSchema.extend({
  provider: z.string().trim().min(1, "Enter the insurer.").max(120),
  name: z.string().trim().min(1, "Enter the investment name.").max(160),
});
