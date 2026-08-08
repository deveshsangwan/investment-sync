import { z } from "zod";
import { isoDateSchema } from "./types";

const npsSchemeSchema = z.object({
  code: z.string().min(1),
  sourceName: z.string().min(1),
  fundManager: z.string().min(1).optional(),
  currentValue: z.number().finite(),
  units: z.number().finite(),
  nav: z.number().finite(),
});

const npsContributionEventSchema = z.object({
  type: z.enum(["contribution", "redemption"]),
  date: isoDateSchema,
  employeeAmount: z.number().finite(),
  employerAmount: z.number().finite(),
  totalAmount: z.number().finite(),
});

const npsActivitySchema = z.object({
  schemeCode: z.string().min(1),
  date: isoDateSchema,
  description: z.string().min(1),
  amount: z.number().finite().optional(),
  nav: z.number().finite().optional(),
  units: z.number().finite().optional(),
});

export const npsDetailsSchema = z.object({
  schemaVersion: z.literal(1),
  tier: z.literal("I"),
  schemeChoice: z.string().min(1).optional(),
  contributionCount: z.number().finite().optional(),
  totalContribution: z.number().finite(),
  totalWithdrawal: z.number().finite(),
  charges: z.number().finite().optional(),
  schemes: z.array(npsSchemeSchema).min(1),
  contributionEvents: z.array(npsContributionEventSchema),
  activities: z.array(npsActivitySchema),
});

export type NpsDetails = z.infer<typeof npsDetailsSchema>;
