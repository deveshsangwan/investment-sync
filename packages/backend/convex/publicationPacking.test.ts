import { expect, it } from "vitest";
import { buildPortfolioPublication } from "@investment-sync/portfolio-domain";
import { parseRows, utf8Bytes } from "./model/importLimits";
import { portfolioLimits } from "./model/portfolioLimits";
import { projectionRecords } from "./model/publicationProjection";
import {
  publicationLimits,
  publicationPayloadChunks,
  scopeRecordSchema,
} from "./model/publicationStages";

it("packs sparse high-cardinality scopes without exceeding the manifest or transaction reference limits", () => {
  const source = {
    group: "G",
    completeness: "complete",
    granularity: "instrument",
    priority: 0,
  };
  const identity = (position: number) => ({
    accountName: position < 1024 ? "A0" : "A1",
    provider: "FAKE",
    instrumentName: `I${position % 1024}`,
    symbol: `S${position % 1024}`,
    assetClass: "indian_stock",
    currency: "INR",
    sourceType: "investment_portfolio_xlsx",
    metadata: {},
    numericProvenance: {},
    source,
  });
  const rows = parseRows(
    JSON.stringify([
      ...Array.from({ length: 2048 }, (_, index) => ({
        ...identity(index),
        kind: "holding",
        sourceDate: "2025-01-01",
        quantity: "1",
        investedAmount: "1",
        currentValue: "1",
        pnlAmount: "0",
      })),
      ...Array.from({ length: 3952 }, (_, index) => ({
        ...identity(index % 2048),
        kind: "transaction",
        tradeDate: index < 2048 ? "2024-01-01" : "2024-01-02",
        type: "buy",
        amount: "1",
      })),
    ]),
  );
  const publication = buildPortfolioPublication({
    existingFacts: rows.map((row, index) => ({
      row,
      provenance: {
        batchId: `b${Math.floor(index / 512)}`,
        sequence: Math.floor(index / 512) + 1,
        rowNumber: (index % 512) + 1,
        parserVersion: "fake",
        fallbackDate: "2025-01-01",
      },
    })),
  });
  expect(publication.facts).toHaveLength(portfolioLimits.facts);
  const records = {
    ...projectionRecords(publication.projection),
    facts: publication.factsToPersist,
  };
  expect(records.positions).toHaveLength(2048);
  expect(records.scopes).toHaveLength(6184);
  expect(records.scopes.length).toBeLessThanOrEqual(
    portfolioLimits.historyScopeRows,
  );
  let receiptCount = 0;
  for (const stage of [
    "history",
    "positions",
    "scopes",
    "summary",
    "assets",
    "timeline",
    "facts",
  ] as const) {
    const chunks = publicationPayloadChunks(
      records[stage],
      stage === "scopes"
        ? records.scopes.map((row) => row.historyKeys.length)
        : undefined,
    );
    receiptCount += chunks.length;
    for (const chunk of chunks) {
      expect(chunk.count).toBeLessThanOrEqual(publicationLimits.chunkRows);
      expect(utf8Bytes(chunk.payloadJson)).toBeLessThanOrEqual(
        publicationLimits.chunkBytes,
      );
      if (stage === "scopes") {
        const scopes = scopeRecordSchema
          .array()
          .parse(JSON.parse(chunk.payloadJson));
        expect(
          scopes.reduce((total, scope) => total + scope.historyKeys.length, 0),
        ).toBeLessThanOrEqual(publicationLimits.scopeChunkReferences);
      }
    }
  }
  expect(receiptCount).toBeLessThanOrEqual(publicationLimits.receipts);
  expect(Math.ceil(records.scopes.length / 5)).toBeGreaterThan(
    publicationLimits.receipts,
  );
});

it("splits dense scope packets at 500 references even when row and byte budgets permit more", () => {
  const scopes = Array.from({ length: 12 }, (_, index) => ({
    key: `scope-${index}`,
    index: 0,
    historyKeys: Array.from({ length: 100 }, (_, key) => `fact-${key}`),
  }));
  const chunks = publicationPayloadChunks(
    scopes,
    scopes.map((scope) => scope.historyKeys.length),
  );
  expect(chunks.map((chunk) => chunk.count)).toEqual([5, 5, 2]);
});
