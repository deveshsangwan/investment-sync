import { v } from "convex/values";

export const assetClassValidator = v.union(
  v.literal("indian_stock"),
  v.literal("mutual_fund"),
  v.literal("us_stock"),
  v.literal("nps"),
  v.literal("ulip"),
  v.literal("crypto"),
  v.literal("cash"),
  v.literal("other"),
);
export const currencyValidator = v.union(
  v.literal("INR"),
  v.literal("USD"),
  v.literal("BTC"),
  v.literal("ETH"),
  v.literal("OTHER"),
);
export const commitResultValidator = v.object({
  status: v.union(v.literal("publishing"), v.literal("committed")),
  versionId: v.id("portfolioVersions"),
  sequence: v.number(),
  digest: v.string(),
});
export const nativeTotalValidator = v.object({
  currency: currencyValidator,
  investedAmount: v.string(),
  currentValue: v.string(),
  pnlAmount: v.string(),
});
export const positionStatusValidator = v.union(
  v.literal("current"),
  v.literal("exited"),
  v.literal("detail"),
);

export const performanceDataQualityValidator = v.union(
  v.literal("exact"),
  v.literal("source_provided"),
  v.literal("estimated"),
  v.literal("insufficient_data"),
);

export const publicHoldingValidator = v.object({
  id: v.string(),
  accountId: v.string(),
  instrumentId: v.string(),
  snapshotDate: v.string(),
  quantity: v.union(v.string(), v.null()),
  investedAmount: v.string(),
  currentValue: v.string(),
  pnlAmount: v.union(v.string(), v.null()),
  pnlPercent: v.union(v.string(), v.null()),
  currency: currencyValidator,
  assetClass: assetClassValidator,
  sourceSheet: v.string(),
  accountName: v.string(),
  provider: v.string(),
  instrumentName: v.string(),
  symbol: v.union(v.string(), v.null()),
  isin: v.union(v.string(), v.null()),
  exchange: v.union(v.string(), v.null()),
  currentValueInInr: v.number(),
  investedAmountInInr: v.number(),
  pnlAmountInInr: v.union(v.number(), v.null()),
});

export const portfolioSummaryValidator = v.object({
  investedAmount: v.number(),
  currentValue: v.number(),
  pnlAmount: v.number(),
  pnlPercent: v.number(),
  allocationByAssetClass: v.array(
    v.object({
      assetClass: v.string(),
      currentValue: v.number(),
      weight: v.number(),
    }),
  ),
  currency: v.literal("INR"),
  exchangeRates: v.array(
    v.object({
      base: v.literal("USD"),
      quote: v.literal("INR"),
      rate: v.number(),
      fetchedAt: v.string(),
      provider: v.literal("frankfurter"),
      isStale: v.boolean(),
    }),
  ),
  asOfDate: v.union(v.string(), v.null()),
});

const npsDetailsValidator = v.object({
  schemaVersion: v.literal(1),
  tier: v.literal("I"),
  schemeChoice: v.optional(v.string()),
  contributionCount: v.optional(v.number()),
  totalContribution: v.number(),
  totalWithdrawal: v.number(),
  charges: v.optional(v.number()),
  schemes: v.array(
    v.object({
      code: v.string(),
      sourceName: v.string(),
      fundManager: v.optional(v.string()),
      currentValue: v.number(),
      units: v.number(),
      nav: v.number(),
    }),
  ),
  contributionEvents: v.array(
    v.object({
      type: v.union(v.literal("contribution"), v.literal("redemption")),
      date: v.string(),
      employeeAmount: v.number(),
      employerAmount: v.number(),
      totalAmount: v.number(),
    }),
  ),
  activities: v.array(
    v.object({
      schemeCode: v.string(),
      date: v.string(),
      description: v.string(),
      amount: v.optional(v.number()),
      nav: v.optional(v.number()),
      units: v.optional(v.number()),
    }),
  ),
});

export const positionsViewValidator = v.object({
  current: v.array(publicHoldingValidator),
  exited: v.array(publicHoldingValidator),
});

export const overviewViewValidator = v.object({
  holdings: v.array(publicHoldingValidator),
  summary: portfolioSummaryValidator,
  performance: v.object({
    xirr: v.optional(v.number()),
    dataQuality: performanceDataQualityValidator,
    absoluteReturnPercent: v.number(),
    cagr: v.optional(v.number()),
    cashFlowCount: v.number(),
    valuationCount: v.number(),
    sourceXirrCoveragePercent: v.number(),
    byAssetClass: v.array(
      v.object({
        assetClass: v.string(),
        xirr: v.optional(v.number()),
        dataQuality: performanceDataQualityValidator,
        currentValue: v.number(),
        investedAmount: v.number(),
      }),
    ),
    asOfDate: v.union(v.string(), v.null()),
  }),
  timeline: v.array(
    v.object({
      snapshotDate: v.string(),
      investedAmount: v.number(),
      currentValue: v.number(),
      pnlAmount: v.optional(v.number()),
      currency: v.literal("INR"),
    }),
  ),
});

const holdingHistoryValidator = publicHoldingValidator
  .omit("isin", "exchange", "pnlAmountInInr")
  .extend({ pnlAmountInInr: v.number() });

export const holdingDetailViewValidator = v.union(
  v.null(),
  v.object({
    positionKey: v.string(),
    holding: publicHoldingValidator.extend({
      sourceXirr: v.optional(v.number()),
      xirr: v.optional(v.number()),
      xirrDataQuality: performanceDataQualityValidator,
      isCurrent: v.boolean(),
      portfolioWeight: v.number(),
      pnlContribution: v.number(),
    }),
    history: v.array(holdingHistoryValidator),
    npsDetails: v.union(npsDetailsValidator, v.null()),
    transactions: v.array(
      v.object({
        id: v.string(),
        tradeDate: v.string(),
        type: v.union(
          v.literal("buy"),
          v.literal("sell"),
          v.literal("dividend"),
          v.literal("fee"),
          v.literal("transfer"),
          v.literal("contribution"),
          v.literal("redemption"),
        ),
        quantity: v.union(v.string(), v.null()),
        price: v.union(v.string(), v.null()),
        amount: v.string(),
        currency: currencyValidator,
        notes: v.union(v.string(), v.null()),
      }),
    ),
  }),
);

export const assetClassDetailViewValidator = v.object({
  assetClass: assetClassValidator,
  holdings: v.array(
    publicHoldingValidator.extend({
      sourceXirr: v.optional(v.number()),
      xirr: v.optional(v.number()),
      xirrDataQuality: performanceDataQualityValidator,
      weightInAssetClass: v.number(),
    }),
  ),
  summary: v.object({
    investedAmount: v.number(),
    currentValue: v.number(),
    pnlAmount: v.number(),
    pnlPercent: v.number(),
    portfolioWeight: v.number(),
    holdingCount: v.number(),
    xirr: v.optional(v.number()),
    xirrDataQuality: performanceDataQualityValidator,
  }),
  timeline: v.array(
    v.object({
      snapshotDate: v.string(),
      investedAmount: v.number(),
      currentValue: v.number(),
    }),
  ),
  exitedHoldings: v.array(
    publicHoldingValidator.extend({ sourceXirr: v.optional(v.number()) }),
  ),
});

export const accountViewValidator = v.object({
  id: v.string(),
  name: v.string(),
  provider: v.string(),
  accountType: v.string(),
  currency: currencyValidator,
});
