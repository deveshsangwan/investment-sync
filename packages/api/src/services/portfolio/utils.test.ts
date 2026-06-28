import { describe, expect, it } from "vitest";
import { filterAggregateRowsBySnapshotGroup } from "./utils";

describe("filterAggregateRowsBySnapshotGroup", () => {
  it("only suppresses aggregates when details exist in the same snapshot group", () => {
    const rows = [
      snapshotRow({ instrumentName: "ABC" }),
      snapshotRow({ instrumentName: "ABC Summary" }),
      snapshotRow({
        accountId: "account-2",
        accountName: "Broker B",
        instrumentName: "Broker B Summary",
      }),
    ];

    expect(
      filterAggregateRowsBySnapshotGroup(rows).map((row) => row.instrumentName),
    ).toEqual(["ABC", "Broker B Summary"]);
  });
});

function snapshotRow(
  overrides: Partial<{
    accountId: string;
    accountName: string;
    provider: string;
    assetClass: string;
    currency: "INR";
    sourceSheet: string;
    snapshotDate: string;
    instrumentName: string;
    sourcePayload: Record<string, unknown>;
  }> = {},
) {
  return {
    accountId: overrides.accountId ?? "account-1",
    accountName: overrides.accountName ?? "Broker A",
    provider: overrides.provider ?? "Tickertape",
    assetClass: overrides.assetClass ?? "indian_stock",
    currency: overrides.currency ?? "INR",
    sourceSheet: overrides.sourceSheet ?? "",
    snapshotDate: overrides.snapshotDate ?? "2026-06-16",
    instrumentName: overrides.instrumentName ?? "ABC",
    sourcePayload: overrides.sourcePayload ?? {},
  };
}
