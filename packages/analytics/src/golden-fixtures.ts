import type {
  PerformanceCashFlowInput,
  PerformanceHoldingInput,
  PerformanceValuationInput,
  PortfolioPerformanceSummary,
} from "./performance";
import type { HoldingInput, PortfolioSummary } from "./portfolio";

export interface PortfolioGoldenFixture {
  name: string;
  holdings: HoldingInput[];
  expected: PortfolioSummary;
}

export function portfolioGoldenFixtures(): PortfolioGoldenFixture[] {
  return [
    {
      name: "mixed INR and converted USD holdings",
      holdings: [
        {
          assetClass: "indian_stock",
          investedAmount: 200,
          currentValue: 250,
        },
        {
          assetClass: "us_stock",
          investedAmount: 8_000,
          currentValue: 10_000,
        },
      ],
      expected: {
        investedAmount: 8_200,
        currentValue: 10_250,
        pnlAmount: 2_050,
        pnlPercent: 25,
        allocationByAssetClass: [
          { assetClass: "us_stock", currentValue: 10_000, weight: 97.56 },
          { assetClass: "indian_stock", currentValue: 250, weight: 2.44 },
        ],
      },
    },
  ];
}

export interface PerformanceGoldenFixture {
  name: string;
  input: {
    cashFlows: PerformanceCashFlowInput[];
    holdings: PerformanceHoldingInput[];
    valuations: PerformanceValuationInput[];
    asOfDate: Date;
  };
  expected: PortfolioPerformanceSummary;
}

const AS_OF_DATE = new Date("2026-01-01T00:00:00.000Z");

export function performanceGoldenFixtures(): PerformanceGoldenFixture[] {
  return [
    {
      name: "cash flows take precedence",
      input: {
        cashFlows: [
          {
            date: new Date("2025-01-01T00:00:00.000Z"),
            amount: 100,
            type: "buy",
          },
        ],
        holdings: [holding({ sourceXirr: 99 })],
        valuations: yearlyValuations(),
        asOfDate: AS_OF_DATE,
      },
      expected: {
        xirr: 20,
        dataQuality: "exact",
        absoluteReturnPercent: 20,
        cagr: 20,
        cashFlowCount: 1,
        valuationCount: 2,
        sourceXirrCoveragePercent: 100,
      },
    },
    {
      name: "source XIRR is the first fallback",
      input: {
        cashFlows: [],
        holdings: [holding({ sourceXirr: 12 })],
        valuations: yearlyValuations(),
        asOfDate: AS_OF_DATE,
      },
      expected: {
        xirr: 12,
        dataQuality: "source_provided",
        absoluteReturnPercent: 20,
        cagr: 20,
        cashFlowCount: 0,
        valuationCount: 2,
        sourceXirrCoveragePercent: 100,
      },
    },
    {
      name: "valuation history is the final calculable fallback",
      input: {
        cashFlows: [],
        holdings: [holding()],
        valuations: yearlyValuations(),
        asOfDate: AS_OF_DATE,
      },
      expected: {
        xirr: 20,
        dataQuality: "estimated",
        absoluteReturnPercent: 20,
        cagr: 20,
        cashFlowCount: 0,
        valuationCount: 2,
        sourceXirrCoveragePercent: 0,
      },
    },
    {
      name: "short history remains insufficient",
      input: {
        cashFlows: [],
        holdings: [holding()],
        valuations: [
          {
            date: new Date("2025-12-01T00:00:00.000Z"),
            investedAmount: 100,
            currentValue: 100,
          },
          { date: AS_OF_DATE, investedAmount: 100, currentValue: 120 },
        ],
        asOfDate: AS_OF_DATE,
      },
      expected: {
        xirr: undefined,
        dataQuality: "insufficient_data",
        absoluteReturnPercent: 20,
        cagr: 755.65,
        cashFlowCount: 0,
        valuationCount: 2,
        sourceXirrCoveragePercent: 0,
      },
    },
  ];
}

function holding(
  overrides: Partial<PerformanceHoldingInput> = {},
): PerformanceHoldingInput {
  return {
    assetClass: "indian_stock",
    investedAmount: 100,
    currentValue: 120,
    ...overrides,
  };
}

function yearlyValuations(): PerformanceValuationInput[] {
  return [
    {
      date: new Date("2025-01-01T00:00:00.000Z"),
      investedAmount: 100,
      currentValue: 100,
    },
    { date: AS_OF_DATE, investedAmount: 100, currentValue: 120 },
  ];
}
