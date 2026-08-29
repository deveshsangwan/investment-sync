import { readFileSync } from "node:fs";
import { parseImportFile } from "../../packages/importers/src/index";

const input = JSON.parse(readFileSync(0, "utf8")) as {
  originalFileName: string;
  contentBase64: string;
};
const parsed = parseImportFile({
  fileName: input.originalFileName,
  content: Buffer.from(input.contentBase64, "base64"),
});
const accountKeys = new Set<string>();
const instrumentKeys = new Set<string>();
const positionKeys = new Set<string>();
const assetClasses = new Set<string>();
const timelineDates = new Set<string>();
const rowKindCounts = new Map<string, number>();
const currencyCounts = new Map<string, number>();

for (const row of parsed.rows) {
  rowKindCounts.set(row.kind, (rowKindCounts.get(row.kind) ?? 0) + 1);
  currencyCounts.set(row.currency, (currencyCounts.get(row.currency) ?? 0) + 1);
  if (row.kind !== "valuation") {
    accountKeys.add(`${normalize(row.provider)}|${normalize(row.accountName)}`);
    instrumentKeys.add(
      `${row.assetClass}|${row.currency}|${row.symbol ? `symbol:${row.symbol.trim().toUpperCase()}` : `name:${normalize(row.instrumentName)}`}`,
    );
  }
  if (row.kind === "holding") {
    positionKeys.add(
      `${normalize(row.provider)}|${normalize(row.accountName)}|${row.assetClass}|${row.currency}|${row.symbol ? row.symbol.trim().toUpperCase() : normalize(row.instrumentName)}`,
    );
    assetClasses.add(row.assetClass);
  }
  const date =
    row.kind === "holding"
      ? row.sourceDate
      : row.kind === "transaction"
        ? row.tradeDate
        : row.valuationDate;
  if (date) timelineDates.add(date);
}

process.stdout.write(
  JSON.stringify({
    sourceType: parsed.sourceType,
    parserVersion: parsed.parserVersion,
    normalizedRows: parsed.rows.length,
    normalizedSerializedBytes: Buffer.byteLength(JSON.stringify(parsed.rows)),
    distinctAccounts: accountKeys.size,
    distinctInstruments: instrumentKeys.size,
    projectedFactWrites: parsed.rows.length,
    projectedReadModelWrites:
      positionKeys.size + assetClasses.size + timelineDates.size + 2,
    rowKindCounts: [...rowKindCounts].map(([key, count]) => ({ key, count })),
    currencyCounts: [...currencyCounts].map(([key, count]) => ({ key, count })),
  }),
);

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}
