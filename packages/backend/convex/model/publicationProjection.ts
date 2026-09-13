import type {
  HoldingFact,
  PortfolioProjection,
  TransactionFact,
} from "@investment-sync/portfolio-domain";
import type { AssetClass } from "@investment-sync/importers/types";
import { capacityError, checkedJson, portfolioLimits } from "./portfolioLimits";

type HistoryRecord = {
  key: string;
  kind: "holding" | "transaction" | "valuation";
  factJson: string;
  assetClass?: AssetClass;
  positionKey?: string;
  transactionScope?: string;
};
type ScopeRecord = {
  key: string;
  index: number;
  historyKeys: string[];
  assetClass?: AssetClass;
};

export function projectionRecords(projection: PortfolioProjection) {
  const histories = new Map<string, HistoryRecord>();
  const scopes = new Map<string, { keys: string[]; assetClass?: AssetClass }>();
  const registerHoldings = (
    key: string,
    facts: HoldingFact[],
    assetClass: AssetClass,
  ) => {
    if (scopes.has(key)) return;
    scopes.set(key, {
      keys: facts.map((fact) => `holding:${fact.factKey}`),
      assetClass,
    });
    for (const fact of facts)
      histories.set(`holding:${fact.factKey}`, {
        key: `holding:${fact.factKey}`,
        kind: "holding",
        assetClass: fact.row.assetClass,
        positionKey: fact.positionKey,
        factJson: checkedJson({ row: fact.row, provenance: fact.provenance }),
      });
  };
  const registerTransactions = (
    key: string,
    facts: TransactionFact[],
    assetClass?: AssetClass,
  ) => {
    if (scopes.has(key)) return;
    scopes.set(key, {
      keys: facts.map((fact) => `transaction:${fact.occurrenceKey}`),
      assetClass,
    });
    for (const fact of facts)
      histories.set(`transaction:${fact.occurrenceKey}`, {
        key: `transaction:${fact.occurrenceKey}`,
        kind: "transaction",
        assetClass: fact.row.assetClass,
        positionKey: fact.positionKey,
        transactionScope: `transactions:${JSON.stringify([fact.accountKey, fact.instrumentKey])}`,
        factJson: checkedJson({
          row: fact.row,
          provenance: fact.provenance,
          occurrenceKey: fact.occurrenceKey,
        }),
      });
  };
  const selected = [
    ...projection.positions.map((position) => ({
      position,
      status: position.status,
    })),
    ...(projection.detailPositions ?? []).map((position) => ({
      position,
      status: "detail" as const,
    })),
  ];
  if (selected.length > portfolioLimits.positions)
    capacityError("Portfolio position capacity exceeded");

  const positions = selected.map(({ position, status }) => {
    const assetClass = position.holding.row.assetClass;
    const historyScope = `position:${position.positionKey}`;
    const transactionScope = `transactions:${JSON.stringify([position.holding.accountKey, position.holding.instrumentKey])}`;
    const instrumentHistoryScope = `instrument:${position.holding.instrumentKey}`;
    const instrumentTransactionScope = `instrumentTransactions:${position.holding.instrumentKey}`;
    registerHoldings(historyScope, position.history, assetClass);
    registerTransactions(transactionScope, position.transactions, assetClass);
    registerHoldings(
      instrumentHistoryScope,
      position.instrumentHistory,
      assetClass,
    );
    registerTransactions(
      instrumentTransactionScope,
      position.instrumentTransactions,
      assetClass,
    );
    return {
      positionKey: position.positionKey,
      status,
      assetClass,
      holdingJson: checkedJson({
        row: position.holding.row,
        provenance: position.holding.provenance,
      }),
      historyScope,
      transactionScope,
      instrumentHistoryScope,
      instrumentTransactionScope,
    };
  });

  registerTransactions("portfolio:cashFlows", projection.cashFlows);
  scopes.set("portfolio:valuations", {
    keys: projection.valuations.map((row) => {
      const key = `valuation:${row.valuationDate}`;
      histories.set(key, {
        key,
        kind: "valuation",
        factJson: checkedJson(row),
      });
      return key;
    }),
  });
  if (histories.size > portfolioLimits.historyFacts)
    capacityError("Portfolio history capacity exceeded");
  const scopeRows: ScopeRecord[] = [];
  for (const [key, { keys, assetClass }] of scopes) {
    if (keys.length > portfolioLimits.historyScopeKeys)
      capacityError("Portfolio history scope capacity exceeded");
    for (
      let offset = 0;
      offset < keys.length;
      offset += portfolioLimits.scopeChunkKeys
    )
      scopeRows.push({
        key,
        index: offset / portfolioLimits.scopeChunkKeys,
        historyKeys: keys.slice(
          offset,
          offset + portfolioLimits.scopeChunkKeys,
        ),
        assetClass,
      });
  }
  if (scopeRows.length > portfolioLimits.historyScopeRows)
    capacityError("Portfolio aggregate history scope capacity exceeded");
  const summary = [
    {
      asOfDate: projection.asOfDate,
      totals: projection.totals,
      hasExplicitValuations: projection.hasExplicitValuations,
      valuationScope: "portfolio:valuations",
      cashFlowScope: "portfolio:cashFlows",
    },
  ];
  const assets = projection.assetClasses.map(({ assetClass, totals }) => ({
    assetClass,
    totals,
  }));
  const timeline = [
    { assetClass: null, timeline: projection.timeline },
    ...projection.assetClasses,
  ].flatMap((asset) =>
    asset.timeline.map((point) => ({
      assetClass: asset.assetClass,
      date: point.snapshotDate,
      totals: point.totals,
    })),
  );
  if (timeline.length > portfolioLimits.timeline)
    capacityError("Portfolio timeline capacity exceeded");
  return {
    history: [...histories.values()],
    positions,
    scopes: scopeRows,
    summary,
    assets,
    timeline,
  };
}
