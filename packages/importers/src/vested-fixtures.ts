import * as XLSX from "xlsx";

export const realizedHeaders = [
  "Security",
  "Sale Date",
  "Acquisition Date",
  "Quantity",
  "Proceeds (USD)",
  "Cost Basis (USD)",
  "Profit/Loss (USD)",
  "Execution ID",
  "Lot ID",
];
export const summaryHeaders = [
  "Security",
  "Quantity",
  "Proceeds (USD)",
  "Cost Basis (USD)",
  "Profit/Loss (USD)",
];

export function vestedWorkbook({
  sales,
  summary,
  holdings = [["FAKE", 10, 100, 120, 20]],
}: {
  sales?: unknown[][];
  summary?: unknown[][];
  holdings?: unknown[][];
} = {}) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        "Security",
        "Quantity",
        "Cost Basis (USD)",
        "Market Value (USD)",
        "Profit/Loss (USD)",
      ],
      ...holdings,
    ]),
    "Unrealized P&L - Summary ",
  );
  if (sales)
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([realizedHeaders, ...sales]),
      "Realized P&L - Breakdown ",
    );
  if (summary)
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([summaryHeaders, ...summary]),
      "Realized P&L - Summary ",
    );

  return {
    fileName: "fake-vested.xlsx",
    content: XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer,
  };
}
