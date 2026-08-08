import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentHoldingRow, PortfolioContext } from "./types";

vi.mock("./cache", () => ({
  cachedPortfolioData: (
    _ctx: PortfolioContext,
    _key: string,
    load: () => Promise<unknown>,
  ) => load(),
}));

vi.mock("./data", () => ({
  cashFlowRows: vi.fn(),
  holdingSnapshotTimelineRows: vi.fn(),
  portfolioValuationRows: vi.fn(),
}));

vi.mock("./latest-holdings", () => ({
  latestCurrentHoldings: vi.fn(),
}));

vi.mock("./utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils")>()),
  getUsdInrRateIfNeeded: vi.fn(),
}));

import {
  cashFlowRows,
  holdingSnapshotTimelineRows,
  portfolioValuationRows,
} from "./data";
import { latestCurrentHoldings } from "./latest-holdings";
import { buildPortfolioOverview } from "./overview";
import { getUsdInrRateIfNeeded } from "./utils";

const latestHolding: CurrentHoldingRow = {
  id: "holding-1",
  accountId: "account-1",
  instrumentId: "instrument-1",
  snapshotDate: "2026-08-08",
  quantity: "1",
  investedAmount: "100",
  currentValue: "120",
  pnlAmount: "20",
  pnlPercent: "20",
  currency: "INR",
  sourcePayload: {},
  sourceSheet: "",
  accountName: "Stocks",
  provider: "Tickertape",
  instrumentName: "ABC",
  symbol: "ABC",
  assetClass: "indian_stock",
};

const valuation = {
  valuationDate: "2026-05-15",
  investedAmount: "100",
  currentValue: "110",
  pnlAmount: "10",
  currency: "INR" as const,
};

describe("buildPortfolioOverview", () => {
  beforeEach(() => {
    vi.mocked(cashFlowRows).mockResolvedValue([]);
    vi.mocked(holdingSnapshotTimelineRows).mockResolvedValue([]);
    vi.mocked(portfolioValuationRows).mockResolvedValue([valuation]);
    vi.mocked(latestCurrentHoldings).mockResolvedValue([latestHolding]);
    vi.mocked(getUsdInrRateIfNeeded).mockResolvedValue(undefined);
  });

  it("adds the latest imported holdings to an older valuation timeline", async () => {
    const overview = await buildPortfolioOverview({} as PortfolioContext);

    expect(overview.timeline.at(-1)).toMatchObject({
      snapshotDate: "2026-08-08",
      investedAmount: 100,
      currentValue: 120,
      pnlAmount: 20,
      currency: "INR",
    });
  });

  it("does not replace a newer explicit valuation", async () => {
    vi.mocked(portfolioValuationRows).mockResolvedValue([
      { ...valuation, valuationDate: "2026-09-01" },
    ]);

    const overview = await buildPortfolioOverview({} as PortfolioContext);

    expect(overview.timeline.at(-1)).toMatchObject({
      snapshotDate: "2026-09-01",
      currentValue: 110,
    });
  });

  it("does not mutate the cached holding timeline when replacing its tail", async () => {
    const cachedTimeline = [
      {
        snapshotDate: "2026-08-08",
        investedAmount: 90,
        currentValue: 100,
        currency: "INR" as const,
      },
    ];
    vi.mocked(portfolioValuationRows).mockResolvedValue([]);
    vi.mocked(holdingSnapshotTimelineRows).mockResolvedValue(cachedTimeline);

    const overview = await buildPortfolioOverview({} as PortfolioContext);

    expect(overview.timeline.at(-1)).toMatchObject({
      snapshotDate: "2026-08-08",
      currentValue: 120,
    });
    expect(cachedTimeline[0]?.currentValue).toBe(100);
  });
});
