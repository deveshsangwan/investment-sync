import { z } from "zod";
import { canonicalizeDecimal } from "./numeric";
import type { RealizedSale } from "./types";

// Report periods and row numbers cannot identify a sale across overlapping exports.
// Without execution IDs, occurrence counts preserve identical lots within a report.
export function realizedSaleIdentity(row: {
  tradeDate: string;
  quantity?: string | number;
  amount: string | number;
  metadata: { realizedSale?: RealizedSale };
}) {
  const sale = row.metadata.realizedSale;
  if (!sale) return undefined;

  if (sale.executionId) {
    return JSON.stringify([
      "realized-execution-lot-v1",
      row.tradeDate,
      sale.executionId,
      sale.lotId ?? sale.acquisitionDate ?? null,
    ]);
  }

  return JSON.stringify([
    "realized-lot-v1",
    row.tradeDate,
    sale.executionId ?? null,
    sale.lotId ?? null,
    sale.acquisitionDate ?? null,
    row.quantity === undefined
      ? null
      : canonicalizeDecimal(String(row.quantity)),
    canonicalizeDecimal(String(row.amount)),
    sale.costBasis,
    sale.realizedPnl,
  ]);
}

const storedSaleIdentitySchema = z.tuple([
  z.string().min(1),
  z.number().int().positive(),
]);

export function parseStoredRealizedSaleIdentity(value: string) {
  const parsed: unknown = JSON.parse(value);
  return storedSaleIdentitySchema.parse(parsed);
}
