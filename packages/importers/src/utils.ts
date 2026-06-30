import { parse } from "csv-parse/sync";

export const INVESTMENT_PORTFOLIO_SUMMARY_SHEET = "Investment Portfolio";

export function parseCsv(content: Buffer): string[][] {
  return parse(content.toString("utf8"), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: true,
  }) as string[][];
}

export function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return "";
}

export function normalizeHeader(value: unknown): string {
  return toStringValue(value)
    .replace(/\u20b9/g, "rs")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseNumber(value: unknown): number | undefined {
  const rawValue = toStringValue(value);
  if (!rawValue || rawValue === "-") return undefined;
  const isParenthesizedNegative = /\([^)]*\)/.test(rawValue);
  const raw = rawValue
    .replace(/rs\.?|inr/gi, "")
    .replace(/[₹,$%\s\u00a0]/g, "")
    .replace(/[()]/g, "")
    .replace(/,/g, "");
  if (!raw || raw === "-") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return isParenthesizedNegative ? -Math.abs(parsed) : parsed;
}

export function parseRequiredNumber(value: unknown, fallback = 0): number {
  return parseNumber(value) ?? fallback;
}

export function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return dateToIsoDate(value);
  const text = toStringValue(value).trim();
  if (!text) return undefined;
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return validDateParts(Number(year), Number(month), Number(day));
  }

  const indianDateMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (indianDateMatch) {
    const [, day = "", month = "", rawYear = ""] = indianDateMatch;
    const year = normalizeCalendarYear(rawYear);
    return validDateParts(year, Number(month), Number(day));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return dateToIsoDate(parsed);
  return undefined;
}

function dateToIsoDate(value: Date): string | undefined {
  if (Number.isNaN(value.getTime())) return undefined;
  return validDateParts(
    value.getFullYear(),
    value.getMonth() + 1,
    value.getDate(),
  );
}

export function validDateParts(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (!isValidCalendarDateParts(year, month, day) || year < 1900) {
    return undefined;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function isValidCalendarDateParts(
  year: number,
  month: number,
  day: number,
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function normalizeCalendarYear(rawYear: string): number {
  if (rawYear.length !== 2) return Number(rawYear);
  const year = Number(rawYear);
  return year >= 70 ? 1900 + year : 2000 + year;
}

export function findHeaderRow(
  rows: unknown[][],
  requiredHeaders: string[],
): number {
  return rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return requiredHeaders.every((header) => {
      const normalized = normalizeHeader(header);
      return headers.some(
        (candidate) =>
          candidate === normalized || candidate.startsWith(`${normalized} `),
      );
    });
  });
}

export function objectFromRow(
  headers: unknown[],
  row: unknown[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key) record[key] = row[index];
  });
  return record;
}

export function sourceDateFromText(text: string): string | undefined {
  const match = text.match(/(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (!match) return undefined;
  const [, day = "", month = "", year = ""] = match;
  const monthNumber = monthNumberFromName(month);
  if (!monthNumber) return undefined;
  return validDateParts(normalizeCalendarYear(year), monthNumber, Number(day));
}

function monthNumberFromName(month: string): number | undefined {
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return months[month.slice(0, 3).toLowerCase()];
}
