import { ConvexError } from "convex/values";

export const portfolioLimits = {
  facts: 6000,
  accounts: 256,
  instruments: 1024,
  positions: 2048,
  historyFacts: 6000,
  historyScopeKeys: 6000,
  historyScopeRows: 8192,
  timeline: 3000,
  documentBytes: 524288,
  householdFactBytes: 6 * 1024 * 1024,
  scopeChunkKeys: 100,
} as const;

export function capacityError(message: string): never {
  throw new ConvexError({ code: "CAPACITY", message });
}

export function checkedJson(value: unknown) {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > portfolioLimits.documentBytes)
    capacityError("Portfolio document exceeds the supported size");
  return json;
}
