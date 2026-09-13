import { describe, expect, it } from "vitest";
import { positionKeyFromHoldingPathname } from "./holding-route";

function holdingPathname(positionKey: string) {
  return `/dashboard/holdings/${encodeURIComponent(positionKey)}`;
}

describe("holding route position keys", () => {
  it.each([
    "5b84e69d-0a10-4e3f-8595-a0a5ad314afd",
    '{"accountId":"brokerage","symbol":"ACME/US"}',
    '{"accountId":"retirement","symbol":"LITERAL%20VALUE"}',
    '{"accountId":"international","symbol":"日本株"}',
  ])("recovers %s from one encoded route segment", (positionKey) => {
    expect(positionKeyFromHoldingPathname(holdingPathname(positionKey))).toBe(
      positionKey,
    );
  });

  it("rejects paths outside the holding detail boundary", () => {
    expect(positionKeyFromHoldingPathname("/holdings/example")).toBeNull();
    expect(
      positionKeyFromHoldingPathname("/dashboard/holdings/example/extra"),
    ).toBeNull();
    expect(
      positionKeyFromHoldingPathname("/dashboard/holdings/malformed%key"),
    ).toBeNull();
  });
});
