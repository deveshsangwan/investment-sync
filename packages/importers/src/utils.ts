import { parse } from "csv-parse/sync";

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
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
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
  const raw = rawValue
    .replace(/rs\.?|inr/gi, "")
    .replace(/[₹,$%\s\u00a0]/g, "")
    .replace(/[()]/g, "")
    .replace(/,/g, "");
  if (!raw || raw === "-") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseRequiredNumber(value: unknown, fallback = 0): number {
  return parseNumber(value) ?? fallback;
}

export function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = toStringValue(value).trim();
  if (!text) return undefined;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
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
  const [, day, month, year] = match;
  const parsed = new Date(
    `${day} ${month} ${year && year.length === 2 ? `20${year}` : year}`,
  );
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}
