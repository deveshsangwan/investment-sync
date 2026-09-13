import type { AssetClass } from "@investment-sync/importers";
import type {
  NativeTimelinePoint,
  PortfolioProjection,
} from "@investment-sync/portfolio-domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireCurrentMembership } from "./auth";
import { capacityError, portfolioLimits } from "./portfolioLimits";
import {
  decodePortfolioTransaction,
  decodePortfolioValuation,
  decodePosition,
  decodePositionHeader,
  type ScopeFactSource,
} from "./readEncoding";

const maximumHistoryRangeRows = portfolioLimits.historyFacts;
const maximumScopeRangeRows = portfolioLimits.historyScopeRows;

export interface ActivePortfolio {
  household: Doc<"households">;
  version: Doc<"portfolioVersions">;
}

export async function activePortfolio(ctx: QueryCtx) {
  const { household } = await requireCurrentMembership(ctx);
  if (!household.activePortfolioVersionId) return null;

  const version = await ctx.db.get(
    "portfolioVersions",
    household.activePortfolioVersionId,
  );
  if (!version || version.householdId !== household._id)
    throw new Error("Active portfolio version is invalid");

  return { household, version } satisfies ActivePortfolio;
}

export async function overviewProjection(
  ctx: QueryCtx,
  active: ActivePortfolio,
) {
  const versionId = active.version._id;
  const [positions, summary, timeline, transactions, valuations] =
    await Promise.all([
      positionsByStatus(ctx, versionId, "current"),
      portfolioSummary(ctx, versionId),
      timelineByAssetClass(ctx, versionId, null),
      historyByKind(ctx, versionId, "transaction"),
      historyByKind(ctx, versionId, "valuation"),
    ]);

  return {
    projection: projection({
      summary,
      positions: positions.map(decodePositionHeader),
      timeline,
      cashFlows: transactions.map(decodePortfolioTransaction),
      valuations: valuations.map(decodePortfolioValuation),
    }),
    counts: {
      ranges: 5,
      positions: positions.length,
      historyFacts: transactions.length + valuations.length,
      timelinePoints: timeline.length,
    },
  };
}

export async function positionsProjection(
  ctx: QueryCtx,
  active: ActivePortfolio,
) {
  const [current, exited, summary] = await Promise.all([
    positionsByStatus(ctx, active.version._id, "current"),
    positionsByStatus(ctx, active.version._id, "exited"),
    portfolioSummary(ctx, active.version._id),
  ]);
  const positions = [...current, ...exited];
  ensureMaximum(
    positions,
    portfolioLimits.positions,
    "Portfolio position capacity exceeded",
  );

  return {
    projection: projection({
      summary,
      positions: positions.map(decodePositionHeader),
    }),
    counts: {
      ranges: 3,
      positions: positions.length,
      historyFacts: 0,
      timelinePoints: 0,
    },
  };
}

export async function holdingDetailProjection(
  ctx: QueryCtx,
  active: ActivePortfolio,
  requestedKey: string,
) {
  const versionId = active.version._id;
  const positionKey = await resolvePositionKey(
    ctx,
    active.household._id,
    requestedKey,
  );
  const selected = await positionByKey(ctx, versionId, positionKey);
  if (!selected) return null;

  const [current, summary, holdings, transactions, historyScopes] =
    await Promise.all([
      positionsByStatus(ctx, versionId, "current"),
      portfolioSummary(ctx, versionId),
      historyByPositionAndKind(ctx, versionId, positionKey, "holding"),
      historyByTransactionScope(ctx, versionId, selected.transactionScope),
      scopesByKeys(ctx, versionId, [
        selected.historyScope,
        selected.transactionScope,
      ]),
    ]);
  let facts = [...holdings, ...transactions];
  const scopedFactIds = new Set(
    historyScopes.flatMap((scope) => scope.factIds),
  );
  const indexedFactIds = new Set(facts.map((fact) => fact._id));
  let fallbackRanges = 0;
  if ([...scopedFactIds].some((factId) => !indexedFactIds.has(factId))) {
    facts = await historyByVersion(ctx, versionId);
    fallbackRanges = 1;
  }
  const source = scopeFactSource(facts, historyScopes);
  const selectedProjection = decodePosition(selected, source);
  const currentProjections = current
    .filter((doc) => doc.positionKey !== selected.positionKey)
    .map(decodePositionHeader);

  return {
    projection: projection({
      summary,
      positions:
        selected.status === "current"
          ? [...currentProjections, selectedProjection]
          : currentProjections,
      detailPositions:
        selected.status === "current" ? [] : [selectedProjection],
    }),
    positionKey,
    counts: {
      ranges: 8 + fallbackRanges,
      positions: current.length + 1,
      historyFacts: facts.length,
      timelinePoints: 0,
    },
  };
}

export async function assetClassProjection(
  ctx: QueryCtx,
  active: ActivePortfolio,
  assetClass: AssetClass,
) {
  const versionId = active.version._id;
  const [
    assetPositions,
    current,
    summary,
    assetSummary,
    timeline,
    indexedFacts,
    indexedScopes,
  ] = await Promise.all([
    positionsByAssetClass(ctx, versionId, assetClass),
    positionsByStatus(ctx, versionId, "current"),
    portfolioSummary(ctx, versionId),
    assetClassSummary(ctx, versionId, assetClass),
    timelineByAssetClass(ctx, versionId, assetClass),
    historyByAssetClass(ctx, versionId, assetClass),
    scopesByAssetClass(ctx, versionId, assetClass),
  ]);
  let facts = indexedFacts;
  let scopes = indexedScopes;
  let fallbackRanges = 0;
  if (assetPositions.length > 0 && scopes.length === 0) {
    const relevantScopeKeys = new Set(
      assetPositions.flatMap((position) => [
        position.historyScope,
        position.transactionScope,
        position.instrumentHistoryScope,
        position.instrumentTransactionScope,
      ]),
    );
    const versionScopes = await scopesByVersion(ctx, versionId);
    scopes = versionScopes.filter((scope) => relevantScopeKeys.has(scope.key));
    const relevantFactIds = new Set(scopes.flatMap((scope) => scope.factIds));
    facts = (await historyByVersion(ctx, versionId)).filter((fact) =>
      relevantFactIds.has(fact._id),
    );
    fallbackRanges = 2;
  }
  const source = scopeFactSource(facts, scopes);
  const currentAssetPositions = current.filter(
    (doc) => doc.assetClass === assetClass,
  );
  const currentAssetKeys = new Set(
    currentAssetPositions.map((doc) => doc.positionKey),
  );
  const globalCurrent = current
    .filter((doc) => !currentAssetKeys.has(doc.positionKey))
    .map(decodePositionHeader);
  const hydratedCurrent = currentAssetPositions.map((doc) =>
    decodePosition(doc, source),
  );
  const exited = assetPositions
    .filter((doc) => doc.status === "exited")
    .map(decodePositionHeader);

  return {
    projection: projection({
      summary,
      positions: [...globalCurrent, ...hydratedCurrent, ...exited],
      assetClasses: [
        {
          assetClass,
          totals: assetSummary?.totals ?? [],
          timeline,
        },
      ],
    }),
    counts: {
      ranges: 7 + fallbackRanges,
      positions: assetPositions.length + current.length,
      hydratedPositions: hydratedCurrent.length,
      historyFacts: facts.length,
      decodedHistoryFacts:
        source.holdingPayloadsById.size + source.transactionPayloadsById.size,
      historyScopeChunks: scopes.length,
      decodedScopes: source.factsByScope.size,
      timelinePoints: timeline.length,
    },
  };
}

export async function logPortfolioRead(
  ctx: QueryCtx,
  view: string,
  counts: Record<string, number>,
) {
  if (process.env.APP_ENV !== "development") return;

  console.info(
    "portfolio.read.metrics",
    JSON.stringify({
      view,
      expected: counts,
      actual: await ctx.meta.getTransactionMetrics(),
    }),
  );
}

function projection(input: {
  summary: Doc<"portfolioSummaries">;
  positions?: PortfolioProjection["positions"];
  detailPositions?: PortfolioProjection["detailPositions"];
  assetClasses?: PortfolioProjection["assetClasses"];
  timeline?: NativeTimelinePoint[];
  valuations?: PortfolioProjection["valuations"];
  cashFlows?: PortfolioProjection["cashFlows"];
}) {
  return {
    projectorVersion: "portfolio-v1",
    asOfDate: input.summary.asOfDate,
    positions: input.positions ?? [],
    detailPositions: input.detailPositions,
    totals: input.summary.totals,
    assetClasses: input.assetClasses ?? [],
    timeline: input.timeline ?? [],
    hasExplicitValuations: input.summary.hasExplicitValuations,
    valuations: input.valuations ?? [],
    cashFlows: input.cashFlows ?? [],
  } satisfies PortfolioProjection;
}

async function portfolioSummary(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
) {
  const summaries = await ctx.db
    .query("portfolioSummaries")
    .withIndex("by_versionId", (query) => query.eq("versionId", versionId))
    .take(2);
  if (summaries.length !== 1)
    throw new Error("Active portfolio summary is invalid");
  const summary = summaries[0];
  if (!summary) throw new Error("Active portfolio summary is invalid");

  return summary;
}

async function assetClassSummary(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  assetClass: AssetClass,
) {
  const summaries = await ctx.db
    .query("assetClassSummaries")
    .withIndex("by_versionId_and_assetClass", (query) =>
      query.eq("versionId", versionId).eq("assetClass", assetClass),
    )
    .take(2);
  if (summaries.length > 1)
    throw new Error("Active asset-class summary is invalid");

  return summaries[0] ?? null;
}

async function positionsByStatus(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  status: "current" | "exited",
) {
  const positions = await ctx.db
    .query("portfolioPositions")
    .withIndex("by_versionId_and_status", (query) =>
      query.eq("versionId", versionId).eq("status", status),
    )
    .take(portfolioLimits.positions + 1);
  ensureMaximum(
    positions,
    portfolioLimits.positions,
    "Portfolio position capacity exceeded",
  );

  return positions;
}

async function positionsByAssetClass(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  assetClass: AssetClass,
) {
  const positions = await ctx.db
    .query("portfolioPositions")
    .withIndex("by_versionId_and_assetClass", (query) =>
      query.eq("versionId", versionId).eq("assetClass", assetClass),
    )
    .take(portfolioLimits.positions + 1);
  ensureMaximum(
    positions,
    portfolioLimits.positions,
    "Portfolio position capacity exceeded",
  );

  return positions;
}

async function positionByKey(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  positionKey: string,
) {
  const positions = await ctx.db
    .query("portfolioPositions")
    .withIndex("by_versionId_and_positionKey", (query) =>
      query.eq("versionId", versionId).eq("positionKey", positionKey),
    )
    .take(2);
  if (positions.length > 1)
    throw new Error("Active portfolio position is ambiguous");

  return positions[0] ?? null;
}

async function resolvePositionKey(
  ctx: QueryCtx,
  householdId: Id<"households">,
  requestedKey: string,
) {
  const aliases = await ctx.db
    .query("legacyHoldingAliases")
    .withIndex("by_householdId_and_legacyId", (query) =>
      query.eq("householdId", householdId).eq("legacyId", requestedKey),
    )
    .take(2);
  if (aliases.length > 1) throw new Error("Legacy holding alias is ambiguous");

  return aliases[0]?.positionKey ?? requestedKey;
}

async function historyByKind(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  kind: "transaction" | "valuation",
) {
  const facts = [];
  const range = ctx.db
    .query("portfolioHistoryFacts")
    .withIndex("by_versionId_and_kind_and_key", (query) =>
      query.eq("versionId", versionId).eq("kind", kind),
    );
  for await (const fact of range) {
    if (facts.length === maximumHistoryRangeRows)
      capacityError("Portfolio history read capacity exceeded");
    facts.push(fact);
  }

  return facts;
}

async function historyByPositionAndKind(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  positionKey: string,
  kind: "holding",
) {
  const facts = [];
  const range = ctx.db
    .query("portfolioHistoryFacts")
    .withIndex("by_versionId_and_positionKey_and_kind_and_key", (query) =>
      query
        .eq("versionId", versionId)
        .eq("positionKey", positionKey)
        .eq("kind", kind),
    );
  for await (const fact of range) {
    if (facts.length === maximumHistoryRangeRows)
      capacityError("Portfolio position history read capacity exceeded");
    facts.push(fact);
  }

  return facts;
}

async function historyByTransactionScope(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  transactionScope: string,
) {
  const facts = [];
  const range = ctx.db
    .query("portfolioHistoryFacts")
    .withIndex("by_versionId_and_transactionScope_and_kind_and_key", (query) =>
      query
        .eq("versionId", versionId)
        .eq("transactionScope", transactionScope)
        .eq("kind", "transaction"),
    );
  for await (const fact of range) {
    if (facts.length === maximumHistoryRangeRows)
      capacityError("Portfolio transaction history read capacity exceeded");
    facts.push(fact);
  }

  return facts;
}

async function historyByAssetClass(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  assetClass: AssetClass,
) {
  const facts = [];
  const range = ctx.db
    .query("portfolioHistoryFacts")
    .withIndex("by_versionId_and_assetClass_and_key", (query) =>
      query.eq("versionId", versionId).eq("assetClass", assetClass),
    );
  for await (const fact of range) {
    if (facts.length === maximumHistoryRangeRows)
      capacityError("Portfolio asset-class history read capacity exceeded");
    facts.push(fact);
  }

  return facts;
}

async function historyByVersion(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
) {
  const facts = [];
  const range = ctx.db
    .query("portfolioHistoryFacts")
    .withIndex("by_versionId_and_key", (query) =>
      query.eq("versionId", versionId),
    );
  for await (const fact of range) {
    if (facts.length === maximumHistoryRangeRows)
      capacityError("Portfolio history read capacity exceeded");
    facts.push(fact);
  }

  return facts;
}

async function scopesByAssetClass(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  assetClass: AssetClass,
) {
  const scopes = [];
  const range = ctx.db
    .query("portfolioHistoryScopes")
    .withIndex("by_versionId_and_assetClass_and_key_and_index", (query) =>
      query.eq("versionId", versionId).eq("assetClass", assetClass),
    );
  for await (const scope of range) {
    if (scopes.length === maximumScopeRangeRows)
      capacityError("Portfolio asset-class scope read capacity exceeded");
    scopes.push(scope);
  }

  return scopes;
}

async function scopesByVersion(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
) {
  const scopes = [];
  const range = ctx.db
    .query("portfolioHistoryScopes")
    .withIndex("by_versionId_and_key_and_index", (query) =>
      query.eq("versionId", versionId),
    );
  for await (const scope of range) {
    if (scopes.length === maximumScopeRangeRows)
      capacityError("Portfolio history scope read capacity exceeded");
    scopes.push(scope);
  }

  return scopes;
}

async function scopesByKeys(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  keys: string[],
) {
  const groups = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query("portfolioHistoryScopes")
        .withIndex("by_versionId_and_key_and_index", (query) =>
          query.eq("versionId", versionId).eq("key", key),
        )
        .take(
          Math.ceil(
            portfolioLimits.historyScopeKeys / portfolioLimits.scopeChunkKeys,
          ) + 1,
        ),
    ),
  );
  const maximumChunks = Math.ceil(
    portfolioLimits.historyScopeKeys / portfolioLimits.scopeChunkKeys,
  );
  for (const group of groups)
    ensureMaximum(
      group,
      maximumChunks,
      "Portfolio history scope capacity exceeded",
    );

  return groups.flat();
}

async function timelineByAssetClass(
  ctx: QueryCtx,
  versionId: Id<"portfolioVersions">,
  assetClass: AssetClass | null,
) {
  const points = await ctx.db
    .query("portfolioTimeline")
    .withIndex("by_versionId_and_assetClass_and_date", (query) =>
      query.eq("versionId", versionId).eq("assetClass", assetClass),
    )
    .take(portfolioLimits.timeline + 1);
  ensureMaximum(
    points,
    portfolioLimits.timeline,
    "Portfolio timeline capacity exceeded",
  );

  return points.map((point) => ({
    snapshotDate: point.date,
    totals: point.totals,
  }));
}

function scopeFactSource(
  facts: Doc<"portfolioHistoryFacts">[],
  scopes: Doc<"portfolioHistoryScopes">[],
): ScopeFactSource {
  const factsById = new Map(facts.map((fact) => [fact._id, fact]));
  const factIdsByScope = new Map<string, Id<"portfolioHistoryFacts">[]>();
  for (const scope of scopes) {
    const factIds = factIdsByScope.get(scope.key) ?? [];
    factIds.push(...scope.factIds);
    factIdsByScope.set(scope.key, factIds);
  }

  return {
    factsById,
    factIdsByScope,
    factsByScope: new Map(),
    holdingPayloadsById: new Map(),
    transactionPayloadsById: new Map(),
  };
}

function ensureMaximum<T>(values: T[], maximum: number, message: string) {
  if (values.length > maximum) capacityError(message);
}
