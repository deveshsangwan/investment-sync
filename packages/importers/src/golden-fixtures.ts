import * as XLSX from "xlsx";
import type { ImportFile, NormalizedImportRow, ParseResult } from "./types";

export interface ParserGoldenFixture {
  name: string;
  file: ImportFile;
  expected: {
    sourceType: ParseResult["sourceType"];
    parserVersion: string;
    warnings: string[];
    rows: NormalizedImportRow[];
  };
}

export function parserGoldenFixtures(): ParserGoldenFixture[] {
  return [
    tickertapeStockGolden(),
    tickertapeMutualFundGolden(),
    npsGolden(),
    investmentWorkbookGolden(),
    vestedWorkbookGolden(),
  ];
}

function tickertapeStockGolden(): ParserGoldenFixture {
  const csv = `,,,Holdings - 16-May-26 IST
Visit: https://tickertape.in/portfolio?tab=holdings

Security,No. of Smallcases,Quantity,Average Cost ₹,Portfolio Weight %,LTP ₹,Invested Value ₹,Current Value ₹,P & L ₹,Net Change %,Daily Change ₹,Daily Change %

Stocks/ETFs

FAKECO,0.00,2.00,100.00,100,125.00,200.00,250.00,50.00,25.00,1.00,0.84`;

  return {
    name: "tickertape stock",
    file: { fileName: "fake-stock-holdings.csv", content: Buffer.from(csv) },
    expected: {
      sourceType: "tickertape_stock_csv",
      parserVersion: "tickertape-stock-v1",
      warnings: [],
      rows: [
        {
          kind: "holding",
          sourceType: "tickertape_stock_csv",
          sourceDate: "2026-05-16",
          accountName: "Indian Stocks",
          provider: "Tickertape",
          instrumentName: "FAKECO",
          symbol: "FAKECO",
          assetClass: "indian_stock",
          currency: "INR",
          quantity: 2,
          investedAmount: 200,
          currentValue: 250,
          pnlAmount: 50,
          pnlPercent: 25,
          metadata: {
            averageCost: 100,
            ltp: 125,
            portfolioWeight: 100,
            dailyChangeAmount: 1,
            dailyChangePercent: 0.84,
          },
        },
      ],
    },
  };
}

function tickertapeMutualFundGolden(): ParserGoldenFixture {
  const csv = `,,,,,Mutual Funds Holdings - Sat May 16 2026
Visit: https://tickertape.in/portfolio?tab=mfholdings

Fund Name,AMC Name,Category,Sub-Category,Plan Type,Option Type,NAV ₹,Units,Invested Amt ₹,Current Value ₹,Weight %,P&L ₹,P&L %,XIRR %,Invested Since
Fake Equity Fund,Fake AMC,Equity,Large Cap,Direct,Growth,12.50,20,200,250,100,50,25,12,2024-01-01
Total,,,,,,,,200,250,100,50,25,,`;

  return {
    name: "tickertape mutual fund",
    file: { fileName: "fake-mf-holdings.csv", content: Buffer.from(csv) },
    expected: {
      sourceType: "tickertape_mutual_fund_csv",
      parserVersion: "tickertape-mf-v1",
      warnings: [],
      rows: [
        {
          kind: "holding",
          sourceType: "tickertape_mutual_fund_csv",
          sourceDate: "2026-05-16",
          accountName: "Mutual Funds",
          provider: "Tickertape",
          instrumentName: "Fake Equity Fund",
          assetClass: "mutual_fund",
          currency: "INR",
          quantity: 20,
          investedAmount: 200,
          currentValue: 250,
          pnlAmount: 50,
          pnlPercent: 25,
          metadata: {
            amcName: "Fake AMC",
            category: "Equity",
            subCategory: "Large Cap",
            planType: "Direct",
            optionType: "Growth",
            nav: 12.5,
            weight: 100,
            xirr: 12,
            investedSince: "2024-01-01",
          },
        },
      ],
    },
  };
}

function npsGolden(): ParserGoldenFixture {
  const csv = `NPS Transaction Statement for Tier I Account

Subscriber Details

PRAN,000000000000
Subscriber Name,FAKE PERSON
Statement Generation Date :August 08 2026 05:32 PM
Scheme Choice - ACTIVE CHOICE

Investment Summary

Value of your Holdings(Investments)as on August 08 2026 (in Rs),No of Contributions,Total Contribution in your account as on August 08 2026 (in Rs),Total Withdrawal as on August 08 2026 (in Rs),Total Notional Gain/Loss as on August 08 2026 (in Rs),Withdrawal/ deduction in units towards intermediary charges (in Rs),Return on Investment(XIRR),10%,
(A),,(B),(C),D=(A-B)+C,E,,,
Rs 1000,2,Rs 900,Rs 0,Rs 100,Rs 10,,,

Investment Details - Scheme Wise Summary
Particulars,Scheme wise Value of your Holdings(Investments) (in Rs) (E = U * N),Total Units ( U ),NAV as on 07-Aug-2026 ( N ),
NPS TRUST- A/C FAKE PENSION FUND SCHEME E - TIER I POP,Rs 600,6,100,
NPS TRUST- A/C FAKE PENSION FUND SCHEME C - TIER I POP,Rs 400,4,100,

Contribution/Redemption Details during the selected period

Date,Particulars,Uploaded By,Employee Contribution(Rs),Employer's Contribution(Rs),Total(Rs),
01/08/2026,Contribution,Portal,100,0,100,

Transaction Details

NPS TRUST- A/C FAKE PENSION FUND SCHEME E - TIER I POP
Date,Description,Amount (in Rs),NAV,Units
01/08/2026,By Contribution,100,100,1
08/08/2026,Closing Balance,,,6
`;
  const details = {
    schemaVersion: 1,
    tier: "I",
    schemeChoice: "ACTIVE CHOICE",
    contributionCount: 2,
    totalContribution: 900,
    totalWithdrawal: 0,
    charges: 10,
    schemes: [
      {
        code: "E",
        sourceName: "NPS TRUST- A/C FAKE PENSION FUND SCHEME E - TIER I POP",
        fundManager: "FAKE PENSION FUND",
        currentValue: 600,
        units: 6,
        nav: 100,
      },
      {
        code: "C",
        sourceName: "NPS TRUST- A/C FAKE PENSION FUND SCHEME C - TIER I POP",
        fundManager: "FAKE PENSION FUND",
        currentValue: 400,
        units: 4,
        nav: 100,
      },
    ],
    contributionEvents: [
      {
        type: "contribution",
        date: "2026-08-01",
        employeeAmount: 100,
        employerAmount: 0,
        totalAmount: 100,
      },
    ],
    activities: [
      {
        schemeCode: "E",
        date: "2026-08-01",
        description: "By Contribution",
        amount: 100,
        nav: 100,
        units: 1,
      },
      {
        schemeCode: "E",
        date: "2026-08-08",
        description: "Closing Balance",
        units: 6,
      },
    ],
  };

  return {
    name: "NPS portal",
    file: { fileName: "fake-nps.csv", content: Buffer.from(csv) },
    expected: {
      sourceType: "nps_csv",
      parserVersion: "nps-portal-csv-v1",
      warnings: [],
      rows: [
        {
          kind: "holding",
          sourceType: "nps_csv",
          sourceDate: "2026-08-08",
          accountName: "NPS",
          provider: "NPS",
          instrumentName: "NPS",
          assetClass: "nps",
          currency: "INR",
          investedAmount: 900,
          currentValue: 1000,
          pnlAmount: 100,
          pnlPercent: 11.11111111111111,
          metadata: { sourceSheet: "NPS", xirr: 10, npsDetails: details },
        },
      ],
    },
  };
}

function investmentWorkbookGolden(): ParserGoldenFixture {
  const workbook = XLSX.utils.book_new();
  append(workbook, "Investment Portfolio", [
    [
      "Date",
      "Asset Type",
      "Investment Amount",
      "Current Value",
      "Gain/Loss",
      "Percentage Change",
    ],
    [new Date("2026-05-16T00:00:00Z"), "Stocks", 200, 250, 50, 25],
  ]);
  append(workbook, "Stock Investments", [
    ["Security", "Quantity", "Invested Value ₹", "Current Value ₹"],
    ["FAKECO", 2, 200, 250],
  ]);
  append(workbook, "Mutual Funds", [
    ["Fund Name", "Units", "Invested Amt ₹", "Current Value ₹"],
  ]);

  return {
    name: "investment workbook",
    file: {
      fileName: "fake-investments.xlsx",
      content: workbookBuffer(workbook),
    },
    expected: {
      sourceType: "investment_portfolio_xlsx",
      parserVersion: "investment-portfolio-workbook-v5",
      warnings: [],
      rows: [
        {
          kind: "holding",
          sourceType: "investment_portfolio_xlsx",
          sourceDate: "2026-05-16",
          accountName: "Indian Stocks",
          provider: "Manual Workbook",
          instrumentName: "FAKECO",
          symbol: "FAKECO",
          assetClass: "indian_stock",
          currency: "INR",
          quantity: 2,
          investedAmount: 200,
          currentValue: 250,
          pnlAmount: undefined,
          pnlPercent: undefined,
          metadata: {
            sourceSheet: "Stock Investments",
            averageCost: undefined,
            ltp: undefined,
            portfolioWeight: undefined,
            smallcases: undefined,
            dailyChangeAmount: undefined,
            dailyChangePercent: undefined,
          },
        },
      ],
    },
  };
}

function vestedWorkbookGolden(): ParserGoldenFixture {
  const workbook = XLSX.utils.book_new();
  append(workbook, "Unrealized P&L - Summary ", [
    [
      "Security",
      "Quantity",
      "Cost Basis (USD)",
      "Market Value (USD)",
      "Profit/Loss (USD)",
      "Profit/Loss (%)",
      "Profit/Loss (INR)",
    ],
    ["FAKEUS", 2, 100, 125, 25, 25, 2075],
  ]);

  return {
    name: "Vested DriveWealth workbook",
    file: { fileName: "fake-vested.xlsx", content: workbookBuffer(workbook) },
    expected: {
      sourceType: "vested_drivewealth_xlsx",
      parserVersion: "vested-drivewealth-v1",
      warnings: [],
      rows: [
        {
          kind: "holding",
          sourceType: "vested_drivewealth_xlsx",
          accountName: "US Stocks",
          provider: "Vested / DriveWealth",
          instrumentName: "FAKEUS",
          symbol: "FAKEUS",
          assetClass: "us_stock",
          currency: "USD",
          quantity: 2,
          investedAmount: 100,
          currentValue: 125,
          pnlAmount: 25,
          pnlPercent: 25,
          metadata: { profitLossInr: 2075 },
        },
      ],
    },
  };
}

function append(workbook: XLSX.WorkBook, name: string, rows: unknown[][]) {
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
}

function workbookBuffer(workbook: XLSX.WorkBook): Buffer {
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array,
  );
}
