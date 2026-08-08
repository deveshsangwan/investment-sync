import { npsDetailsSchema, type NpsDetails } from "./nps-details";
import type { ImportFile, ParseResult, PortfolioImporter } from "./types";
import {
  findHeaderRow,
  findColumnIndex,
  NPS_SOURCE_SHEET,
  normalizeHeader,
  parseCsv,
  parseNumber,
  requireColumnIndex,
  sourceDateFromText,
  toIsoDate,
  toStringValue,
} from "./utils";

const NPS_SOURCE_TYPE = "nps_csv" as const;
const MONEY_TOLERANCE_RATIO = 0.001;
const UNIT_TOLERANCE_RATIO = 0.0001;

export const npsPortalCsvImporter: PortfolioImporter = {
  sourceType: NPS_SOURCE_TYPE,
  parserVersion: "nps-portal-csv-v1",
  detect(file: ImportFile) {
    if (!file.fileName.toLowerCase().endsWith(".csv")) {
      return {
        sourceType: NPS_SOURCE_TYPE,
        confidence: 0,
        reason: "Not a CSV file",
      };
    }

    const text = normalizeText(file.content.toString("utf8", 0, 12_000));
    const isNpsStatement =
      text.includes("nps transaction statement") &&
      text.includes("investment summary") &&
      text.includes("investment details - scheme wise summary");

    return {
      sourceType: NPS_SOURCE_TYPE,
      confidence: isNpsStatement ? 0.99 : 0,
      reason: isNpsStatement
        ? "NPS transaction statement sections detected"
        : "NPS transaction statement markers not found",
    };
  },
  parse(file: ImportFile): ParseResult {
    const rows = parseCsv(file.content);
    assertTierIStatement(rows);

    const warnings: string[] = [];
    const summary = parseSummary(rows, warnings);
    const schemes = parseSchemes(rows);
    const contributionEvents = parseContributionEvents(rows, warnings);
    const activities = parseActivities(rows, warnings);
    reconcileSummary(summary, warnings);
    reconcileSchemes(summary.currentValue, schemes, activities, warnings);

    const details = npsDetailsSchema.parse({
      schemaVersion: 1,
      tier: "I",
      ...(summary.schemeChoice ? { schemeChoice: summary.schemeChoice } : {}),
      ...(summary.contributionCount !== undefined
        ? { contributionCount: summary.contributionCount }
        : {}),
      totalContribution: summary.totalContribution,
      totalWithdrawal: summary.totalWithdrawal,
      ...(summary.charges !== undefined ? { charges: summary.charges } : {}),
      schemes,
      contributionEvents,
      activities,
    });
    const investedAmount = summary.totalContribution - summary.totalWithdrawal;

    return {
      sourceType: NPS_SOURCE_TYPE,
      parserVersion: this.parserVersion,
      rows: [
        {
          kind: "holding",
          sourceType: NPS_SOURCE_TYPE,
          sourceDate: summary.sourceDate,
          accountName: "NPS",
          provider: "NPS",
          instrumentName: "NPS",
          assetClass: "nps",
          currency: "INR",
          investedAmount,
          currentValue: summary.currentValue,
          pnlAmount: summary.pnlAmount,
          pnlPercent:
            investedAmount > 0
              ? (summary.pnlAmount / investedAmount) * 100
              : undefined,
          metadata: {
            sourceSheet: NPS_SOURCE_SHEET,
            ...(summary.xirr !== undefined ? { xirr: summary.xirr } : {}),
            npsDetails: details,
          },
        },
      ],
      warnings,
    };
  },
};

type Summary = {
  sourceDate: string;
  currentValue: number;
  contributionCount?: number;
  totalContribution: number;
  totalWithdrawal: number;
  pnlAmount: number;
  charges?: number;
  xirr?: number;
  schemeChoice?: string;
};

function parseSummary(rows: string[][], warnings: string[]): Summary {
  const headerRow = findRow(rows, "value of your holdings");
  const headers = rows[headerRow] ?? [];
  const currentIndex = requireColumnIndex(
    headers,
    ["value of your holdings"],
    "NPS Investment Summary",
  );
  const contributionCountIndex = requireColumnIndex(
    headers,
    ["no of contributions"],
    "NPS Investment Summary",
  );
  const contributionIndex = requireColumnIndex(
    headers,
    ["total contribution in your account"],
    "NPS Investment Summary",
  );
  const withdrawalIndex = requireColumnIndex(
    headers,
    ["total withdrawal"],
    "NPS Investment Summary",
  );
  const pnlIndex = requireColumnIndex(
    headers,
    ["total notional gain/loss"],
    "NPS Investment Summary",
  );
  const chargesIndex = optionalColumnIndex(headers, [
    "withdrawal/ deduction in units",
  ]);
  const xirrIndex = optionalColumnIndex(headers, [
    "return on investment(xirr)",
  ]);
  const sourceDate = sourceDateFromText(headers[currentIndex] ?? "");
  if (!sourceDate) {
    throw new Error("NPS Investment Summary is missing a valid holdings date");
  }

  const schemeSection = findOptionalRow(
    rows,
    "investment details - scheme wise summary",
    headerRow + 1,
  );
  const values = rows
    .slice(headerRow + 1, schemeSection < 0 ? rows.length : schemeSection)
    .find(
      (row) =>
        parseNumber(row[currentIndex]) !== undefined &&
        parseNumber(row[contributionIndex]) !== undefined,
    );
  if (!values) {
    throw new Error("NPS Investment Summary is missing its values row");
  }

  const currentValue = requireNumber(values[currentIndex], "holdings value");
  const totalContribution = requireNumber(
    values[contributionIndex],
    "total contribution",
  );
  const totalWithdrawal = numberOrBlankZero(
    values[withdrawalIndex],
    "total withdrawal",
  );
  const pnlAmount = requireNumber(values[pnlIndex], "notional gain/loss");
  const contributionCount = parseOptionalNumber(
    values[contributionCountIndex],
    "contribution count",
    warnings,
  );
  const charges =
    chargesIndex === undefined
      ? undefined
      : parseOptionalNumber(values[chargesIndex], "charges", warnings);
  const xirrCell =
    xirrIndex === undefined
      ? undefined
      : headers
          .slice(xirrIndex + 1)
          .find((cell) => toStringValue(cell).trim().length > 0);
  const xirr = parseNumber(xirrCell);
  if (xirrIndex !== undefined && xirr === undefined) {
    warnings.push("NPS Investment Summary is missing its XIRR value");
  }
  const schemeChoice = rows
    .flat()
    .map(toStringValue)
    .map((value) => value.match(/scheme choice\s*-\s*(.+)/i)?.[1]?.trim())
    .find(Boolean);

  return {
    sourceDate,
    currentValue,
    ...(contributionCount !== undefined ? { contributionCount } : {}),
    totalContribution,
    totalWithdrawal,
    pnlAmount,
    ...(charges !== undefined ? { charges } : {}),
    ...(xirr !== undefined ? { xirr } : {}),
    ...(schemeChoice ? { schemeChoice } : {}),
  };
}

function parseSchemes(rows: string[][]): NpsDetails["schemes"] {
  const sectionRow = findRow(rows, "investment details - scheme wise summary");
  const relativeHeader = findHeaderRow(rows.slice(sectionRow + 1), [
    "Particulars",
    "Total Units",
    "NAV",
  ]);
  if (relativeHeader < 0) {
    throw new Error("NPS Scheme Wise Summary is missing its header row");
  }
  const headerRow = sectionRow + 1 + relativeHeader;
  const headers = rows[headerRow] ?? [];
  const nameIndex = requireColumnIndex(
    headers,
    ["particulars"],
    "NPS Scheme Wise Summary",
  );
  const valueIndex = requireColumnIndex(
    headers,
    ["scheme wise value of your holdings"],
    "NPS Scheme Wise Summary",
  );
  const unitsIndex = requireColumnIndex(
    headers,
    ["total units"],
    "NPS Scheme Wise Summary",
  );
  const navIndex = requireColumnIndex(
    headers,
    ["nav as on"],
    "NPS Scheme Wise Summary",
  );
  const contributionSection = findOptionalRow(
    rows,
    "contribution/redemption details",
    headerRow + 1,
  );
  const transactionSection = findOptionalRow(
    rows,
    "transaction details",
    headerRow + 1,
  );
  const endRow = [contributionSection, transactionSection]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  const schemes = rows
    .slice(headerRow + 1, endRow ?? rows.length)
    .flatMap((row) => {
      const sourceName = toStringValue(row[nameIndex]).trim();
      const code = schemeCodeFromName(sourceName);
      if (!sourceName || !code) return [];

      const currentValue = requireNumber(
        row[valueIndex],
        `Scheme ${code} current value`,
      );
      const units = requireNumber(row[unitsIndex], `Scheme ${code} units`);
      const nav = requireNumber(row[navIndex], `Scheme ${code} NAV`);
      const fundManager = sourceName
        .match(/a\/c\s+(.+?)\s+scheme\s+[a-z]\b/i)?.[1]
        ?.trim();

      return [
        {
          code,
          sourceName,
          ...(fundManager ? { fundManager } : {}),
          currentValue,
          units,
          nav,
        },
      ];
    });

  if (schemes.length === 0) {
    throw new Error("NPS Scheme Wise Summary contains no scheme rows");
  }
  return schemes;
}

function parseContributionEvents(
  rows: string[][],
  warnings: string[],
): NpsDetails["contributionEvents"] {
  const sectionRow = findOptionalRow(rows, "contribution/redemption details");
  if (sectionRow < 0) return [];
  const transactionSection = findOptionalRow(
    rows,
    "transaction details",
    sectionRow + 1,
  );
  const endRow = transactionSection < 0 ? rows.length : transactionSection;
  const sectionRows = rows.slice(sectionRow + 1, endRow);
  const relativeHeader = findHeaderRow(sectionRows, [
    "Date",
    "Employee Contribution(Rs)",
    "Employer's Contribution(Rs)",
    "Total(Rs)",
  ]);
  if (relativeHeader < 0) {
    if (hasContent(sectionRows)) {
      warnings.push("NPS Contribution Details has an unrecognized header");
    }
    return [];
  }
  const headerRow = sectionRow + 1 + relativeHeader;
  const headers = rows[headerRow] ?? [];
  const dateIndex = requireColumnIndex(
    headers,
    ["date"],
    "NPS Contribution Details",
  );
  const employeeIndex = requireColumnIndex(
    headers,
    ["employee contribution(rs)"],
    "NPS Contribution Details",
  );
  const employerIndex = requireColumnIndex(
    headers,
    ["employer's contribution(rs)"],
    "NPS Contribution Details",
  );
  const totalIndex = requireColumnIndex(
    headers,
    ["total(rs)"],
    "NPS Contribution Details",
  );
  const particularsIndex = findColumnIndex(
    headers,
    ["particulars"],
    "NPS Contribution Details",
  );

  return rows.slice(headerRow + 1, endRow).flatMap((row, index) => {
    const date = toIsoDate(row[dateIndex]);
    if (!date) {
      if (hasContent([row])) {
        warnings.push(
          `NPS contribution row ${index + 1} has an invalid date and was skipped`,
        );
      }
      return [];
    }
    const employeeAmount = numberOrBlankZeroWithWarning(
      row[employeeIndex],
      `contribution/redemption row ${index + 1} employee amount`,
      warnings,
    );
    const employerAmount = numberOrBlankZeroWithWarning(
      row[employerIndex],
      `contribution/redemption row ${index + 1} employer amount`,
      warnings,
    );
    const type = contributionEventType(
      particularsIndex === undefined ? undefined : row[particularsIndex],
      employeeAmount,
      employerAmount,
    );
    if (!type) {
      warnings.push(
        `NPS contribution/redemption row ${index + 1} has an unknown type and was skipped`,
      );
      return [];
    }
    const totalAmount = requireNumber(
      row[totalIndex],
      `contribution/redemption row ${index + 1} total`,
    );
    warnIfDifferent(
      totalAmount,
      employeeAmount + employerAmount,
      moneyTolerance(totalAmount),
      `Contribution/redemption row ${index + 1} does not reconcile to its employee and employer amounts`,
      warnings,
    );
    return [{ type, date, employeeAmount, employerAmount, totalAmount }];
  });
}

function parseActivities(
  rows: string[][],
  warnings: string[],
): NpsDetails["activities"] {
  const sectionRow = findOptionalRow(rows, "transaction details");
  if (sectionRow < 0) return [];
  const activities: NpsDetails["activities"] = [];
  let hasUnparsedContent = false;
  let schemeCode: string | undefined;
  let columns:
    | {
        date: number;
        description: number;
        amount: number;
        nav: number;
        units: number;
      }
    | undefined;

  for (const row of rows.slice(sectionRow + 1)) {
    const firstCell = toStringValue(row[0]).trim();
    const nextScheme = schemeCodeFromName(firstCell);
    if (nextScheme) {
      schemeCode = nextScheme;
      columns = undefined;
      continue;
    }
    if (
      findHeaderRow(
        [row],
        ["Date", "Description", "Amount", "NAV", "Units"],
      ) === 0
    ) {
      columns = {
        date: requireColumnIndex(row, ["date"], "NPS Transaction Details"),
        description: requireColumnIndex(
          row,
          ["description"],
          "NPS Transaction Details",
        ),
        amount: requireColumnIndex(
          row,
          ["amount (in rs)"],
          "NPS Transaction Details",
        ),
        nav: requireColumnIndex(row, ["nav"], "NPS Transaction Details"),
        units: requireColumnIndex(row, ["units"], "NPS Transaction Details"),
      };
      continue;
    }
    if (!schemeCode || !columns) {
      if (hasContent([row])) hasUnparsedContent = true;
      continue;
    }
    const date = toIsoDate(row[columns.date]);
    const description = toStringValue(row[columns.description]).trim();
    if (!date || !description) {
      if (hasContent([row])) hasUnparsedContent = true;
      continue;
    }
    const rowLabel = `transaction row ${activities.length + 1}`;
    const amount = parseOptionalNumber(
      row[columns.amount],
      `${rowLabel} amount`,
      warnings,
    );
    const nav = parseOptionalNumber(
      row[columns.nav],
      `${rowLabel} NAV`,
      warnings,
    );
    const units = parseOptionalNumber(
      row[columns.units],
      `${rowLabel} units`,
      warnings,
    );
    activities.push({
      schemeCode,
      date,
      description,
      ...(amount !== undefined ? { amount } : {}),
      ...(nav !== undefined ? { nav } : {}),
      ...(units !== undefined ? { units } : {}),
    });
  }
  if (hasUnparsedContent) {
    warnings.push("NPS Transaction Details contains rows that were skipped");
  }
  return activities;
}

function reconcileSummary(summary: Summary, warnings: string[]) {
  const expectedPnl =
    summary.currentValue - summary.totalContribution + summary.totalWithdrawal;
  warnIfDifferent(
    summary.pnlAmount,
    expectedPnl,
    moneyTolerance(summary.currentValue),
    "NPS notional gain/loss does not reconcile to value, contributions, and withdrawals",
    warnings,
  );
}

function reconcileSchemes(
  currentValue: number,
  schemes: NpsDetails["schemes"],
  activities: NpsDetails["activities"],
  warnings: string[],
) {
  warnIfDifferent(
    schemes.reduce((total, scheme) => total + scheme.currentValue, 0),
    currentValue,
    moneyTolerance(currentValue),
    "NPS scheme values do not reconcile to the aggregate holdings value",
    warnings,
  );
  for (const scheme of schemes) {
    warnIfDifferent(
      scheme.currentValue,
      scheme.units * scheme.nav,
      moneyTolerance(scheme.currentValue),
      `NPS Scheme ${scheme.code} value does not reconcile to units and NAV`,
      warnings,
    );
    const closing = activities.find(
      (activity) =>
        activity.schemeCode === scheme.code &&
        normalizeText(activity.description) === "closing balance" &&
        activity.units !== undefined,
    );
    if (closing?.units !== undefined) {
      warnIfDifferent(
        closing.units,
        scheme.units,
        unitTolerance(scheme.units),
        `NPS Scheme ${scheme.code} closing units do not reconcile to the scheme summary`,
        warnings,
      );
    }
  }
}

function findRow(rows: string[][], label: string, start = 0): number {
  const index = findOptionalRow(rows, label, start);
  if (index < 0) throw new Error(`NPS statement is missing section: ${label}`);
  return index;
}

function findOptionalRow(rows: string[][], label: string, start = 0): number {
  const normalized = normalizeHeader(label);
  const relative = rows
    .slice(start)
    .findIndex((row) =>
      row.some((cell) => normalizeHeader(cell).includes(normalized)),
    );
  return relative < 0 ? -1 : start + relative;
}

function requireNumber(value: string | undefined, label: string): number {
  const parsed = parseNumber(value);
  if (parsed === undefined) {
    throw new Error(`NPS statement has an invalid value for ${label}`);
  }
  return parsed;
}

function numberOrBlankZero(value: string | undefined, label: string): number {
  const text = toStringValue(value).trim();
  if (!text || text === "-") return 0;
  return requireNumber(value, label);
}

function numberOrBlankZeroWithWarning(
  value: string | undefined,
  label: string,
  warnings: string[],
): number {
  const text = toStringValue(value).trim();
  if (!text || text === "-") return 0;
  return parseOptionalNumber(value, label, warnings) ?? 0;
}

function parseOptionalNumber(
  value: string | undefined,
  label: string,
  warnings: string[],
): number | undefined {
  const text = toStringValue(value).trim();
  if (!text || text === "-") return undefined;
  const parsed = parseNumber(value);
  if (parsed === undefined)
    warnings.push(`NPS statement has an invalid ${label}`);
  return parsed;
}

function warnIfDifferent(
  actual: number,
  expected: number,
  tolerance: number,
  warning: string,
  warnings: string[],
) {
  if (Math.abs(actual - expected) > tolerance) warnings.push(warning);
}

function moneyTolerance(value: number) {
  return Math.max(1, Math.abs(value) * MONEY_TOLERANCE_RATIO);
}

function unitTolerance(value: number) {
  return Math.max(0.001, Math.abs(value) * UNIT_TOLERANCE_RATIO);
}

function assertTierIStatement(rows: string[][]) {
  const headings = rows
    .flat()
    .map(toStringValue)
    .map(normalizeText)
    .filter((cell) => cell.includes("nps transaction statement"));
  const hasTierI = headings.some((heading) =>
    heading.includes("tier i account"),
  );
  const hasTierII = headings.some((heading) =>
    heading.includes("tier ii account"),
  );
  if (hasTierI && hasTierII) {
    throw new Error(
      "Combined Tier I and Tier II NPS statements are not supported",
    );
  }
  if (!hasTierI) {
    throw new Error(
      hasTierII
        ? "Tier II NPS statements are not supported yet"
        : "Could not identify a Tier I NPS statement",
    );
  }
}

function optionalColumnIndex(
  headers: string[],
  aliases: string[],
): number | undefined {
  return findColumnIndex(headers, aliases, "NPS Investment Summary");
}

function schemeCodeFromName(value: string) {
  return value.match(/\bscheme\s+([a-z])\b/i)?.[1]?.toUpperCase();
}

function contributionEventType(
  value: string | undefined,
  employeeAmount: number,
  employerAmount: number,
): "contribution" | "redemption" | undefined {
  const normalized = normalizeText(toStringValue(value));
  if (normalized.includes("contribution")) return "contribution";
  if (normalized.includes("redemption") || normalized.includes("withdrawal")) {
    return "redemption";
  }
  if (employeeAmount !== 0 || employerAmount !== 0) return "contribution";
  return undefined;
}

function hasContent(rows: string[][]) {
  return rows.some((row) => row.some((cell) => toStringValue(cell).trim()));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
