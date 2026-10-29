import {
  FinancialDecimal,
  parseSourceDecimal,
  decimalFromLegacyNumber,
} from "./numeric";
import { getSourceDecimals, withSourceDecimals } from "./source-decimals";
import type { NormalizedTransactionRow } from "./types";
import {
  objectFromRow,
  pick,
  requireColumns,
  requireHeaderRow,
  toIsoDate,
  toStringValue,
} from "./utils";

const columns = {
  Security: ["security", "symbol"],
  Quantity: ["quantity", "quantity sold"],
  Proceeds: [
    "proceeds (usd)",
    "sale proceeds (usd)",
    "sale value (usd)",
    "sell value (usd)",
  ],
  "Cost basis": ["cost basis (usd)", "purchase value (usd)", "buy value (usd)"],
  "Realized P&L": [
    "profit/loss (usd)",
    "realized p&l (usd)",
    "realized p/l (usd)",
  ],
};
const saleDates = ["sale date", "sell date", "date of sale", "date sold"];
const acquisitionDates = [
  "acquisition date",
  "purchase date",
  "buy date",
  "date of purchase",
  "date acquired",
];

export function parseVestedSales(breakdown: unknown[][], summary: unknown[][]) {
  const transactions: NormalizedTransactionRow[] = [];
  const warnings: string[] = [];

  if (hasContent(breakdown)) {
    const sheetName = "Realized P&L - Breakdown";
    const header = requireHeaderRow(breakdown, ["Security"], sheetName);
    const headers = breakdown[header] ?? [];
    requireColumns(headers, { ...columns, "Sale date": saleDates }, sheetName);

    for (const cells of breakdown.slice(header + 1)) {
      const record = objectFromRow(headers, cells);
      const symbol = toStringValue(pick(record, columns.Security)).trim();
      if (!symbol || isTotal(symbol)) continue;

      const tradeDate = toIsoDate(pick(record, saleDates));
      if (!tradeDate) throw new Error(`Invalid Vested sale date for ${symbol}`);

      const acquisitionCell = pick(record, acquisitionDates);
      const acquisitionDate = toIsoDate(acquisitionCell);
      if (toStringValue(acquisitionCell).trim() && !acquisitionDate)
        throw new Error(`Invalid Vested acquisition date for ${symbol}`);
      if (acquisitionDate && acquisitionDate > tradeDate)
        throw new Error(
          `Vested acquisition date follows sale date for ${symbol}`,
        );

      const quantity = requiredDecimal(
        pick(record, columns.Quantity),
        "quantity",
      );
      const proceeds = requiredDecimal(
        pick(record, columns.Proceeds),
        "proceeds",
      );
      const costBasis = requiredDecimal(
        pick(record, columns["Cost basis"]),
        "cost basis",
      );
      const realizedPnl = requiredDecimal(
        pick(record, columns["Realized P&L"]),
        "realized P&L",
      );
      if (
        new FinancialDecimal(quantity).lte(0) ||
        new FinancialDecimal(proceeds).lt(0) ||
        new FinancialDecimal(costBasis).lt(0)
      )
        throw new Error(
          `Invalid Vested sale quantity or amounts for ${symbol}`,
        );

      transactions.push(
        withSourceDecimals(
          {
            kind: "transaction",
            sourceType: "vested_drivewealth_xlsx",
            accountName: "US Stocks",
            provider: "Vested / DriveWealth",
            instrumentName: symbol,
            symbol,
            assetClass: "us_stock",
            currency: "USD",
            type: "sell",
            tradeDate,
            quantity: Number(quantity),
            amount: Number(proceeds),
            metadata: {
              sourceSheet: "Realized P&L - Breakdown",
              realizedSale: {
                acquisitionDate,
                costBasis,
                realizedPnl,
                executionId:
                  toStringValue(
                    pick(record, [
                      "execution id",
                      "trade id",
                      "transaction id",
                    ]),
                  ).trim() || undefined,
                lotId:
                  toStringValue(pick(record, ["lot id"])).trim() || undefined,
              },
            },
          },
          {
            quantity: pick(record, columns.Quantity),
            amount: pick(record, columns.Proceeds),
          },
        ),
      );
    }
  }

  if (hasContent(summary)) {
    reconcileSummary(summary, transactions);
  } else if (transactions.length) {
    warnings.push(
      "Vested realized summary is absent; sale totals could not be reconciled.",
    );
  }

  return { transactions, warnings };
}

function reconcileSummary(
  rows: unknown[][],
  transactions: NormalizedTransactionRow[],
) {
  const sheetName = "Realized P&L - Summary";
  const header = requireHeaderRow(rows, ["Security"], sheetName);
  const headers = rows[header] ?? [];
  requireColumns(headers, columns, sheetName);
  const totals = new Map<string, string[]>();
  let reportedTotal: string[] | undefined;

  for (const cells of rows.slice(header + 1)) {
    const record = objectFromRow(headers, cells);
    const symbol = toStringValue(pick(record, columns.Security))
      .trim()
      .toUpperCase();
    if (!symbol) continue;

    const amounts = [
      columns.Quantity,
      columns.Proceeds,
      columns["Cost basis"],
      columns["Realized P&L"],
    ].map((aliases) =>
      requiredDecimal(pick(record, aliases), aliases[0] ?? "amount"),
    );
    if (isTotal(symbol)) {
      if (reportedTotal)
        throw new Error("Duplicate Vested realized summary total");
      reportedTotal = amounts;
      continue;
    }

    if (totals.has(symbol))
      throw new Error(`Duplicate Vested realized summary security ${symbol}`);
    totals.set(symbol, amounts);
  }

  const actual = new Map<string, string[]>();
  for (const transaction of transactions) {
    const sale = transaction.metadata.realizedSale;
    if (!sale) continue;

    const symbol = transaction.instrumentName.toUpperCase();
    const previous = actual.get(symbol) ?? ["0", "0", "0", "0"];
    // The raw source cells, rather than the legacy numeric fields, retain all digits.
    const amounts = saleAmounts(transaction);
    actual.set(
      symbol,
      previous.map((value, index) =>
        new FinancialDecimal(value).plus(amounts[index] ?? "0").toFixed(),
      ),
    );
  }

  for (const symbol of new Set([...totals.keys(), ...actual.keys()])) {
    compareTotals(
      totals.get(symbol) ?? ["0", "0", "0", "0"],
      actual.get(symbol) ?? ["0", "0", "0", "0"],
      symbol,
    );
  }

  if (reportedTotal) {
    const sum = [...actual.values()].reduce(
      (total, amounts) =>
        total.map((value, index) =>
          new FinancialDecimal(value).plus(amounts[index] ?? "0").toFixed(),
        ),
      ["0", "0", "0", "0"],
    );
    compareTotals(reportedTotal, sum, "Total");
  }
}

function saleAmounts(transaction: NormalizedTransactionRow) {
  const cells = getSourceDecimals(transaction);
  return [
    requiredDecimal(cells?.quantity, "quantity"),
    requiredDecimal(cells?.amount, "proceeds"),
    transaction.metadata.realizedSale?.costBasis ?? "0",
    transaction.metadata.realizedSale?.realizedPnl ?? "0",
  ];
}

function compareTotals(expected: string[], actual: string[], symbol: string) {
  if (
    expected.some((amount, index) =>
      new FinancialDecimal(amount)
        .minus(actual[index] ?? "0")
        .abs()
        .gt(index === 0 ? "0.0000000001" : "0.01"),
    )
  )
    throw new Error(
      `Vested realized summary does not reconcile with breakdown for ${symbol}`,
    );
}

function requiredDecimal(value: unknown, label: string) {
  const decimal =
    typeof value === "number" && Number.isFinite(value)
      ? decimalFromLegacyNumber(value)
      : parseSourceDecimal(value);
  if (decimal === undefined)
    throw new Error(`Vested realized sheet is missing or has invalid ${label}`);
  return decimal;
}

function hasContent(rows: unknown[][]) {
  return rows.some((row) => row.some((cell) => toStringValue(cell).trim()));
}

function isTotal(symbol: string) {
  return /^(?:grand )?total$/i.test(symbol);
}
