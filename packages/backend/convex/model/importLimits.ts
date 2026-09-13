import { publicImportLimits } from "../../src/import-limits";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Base64, ConvexError } from "convex/values";

export const importLimits = {
  ...publicImportLimits,
  accounts: 64,
  instruments: 512,
  chunkRows: 100,
  chunkBytes: 65536,
  chunks: 1100,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  uploadGraceMs: 2 * 60 * 60 * 1000,
  parseLeaseMs: 15 * 60 * 1000,
} as const;

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function digest(value: string) {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

export function storageChecksumToHex(value: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new ConvexError({
      code: "VALIDATION",
      message: "Invalid storage SHA-256 checksum",
    });
  const bytes = Base64.toByteArray(value);
  if (bytes.length !== 32)
    throw new ConvexError({
      code: "VALIDATION",
      message: "Invalid storage SHA-256 checksum",
    });
  return bytesToHex(bytes);
}

export function parseRows(json: string) {
  const value: unknown = JSON.parse(json);
  return exactNormalizedImportRowSchema.array().parse(value);
}

export function validateIdentityCapacity(rows: ReturnType<typeof parseRows>) {
  const accounts = new Set<string>();
  const instruments = new Set<string>();
  for (const row of rows) {
    if (row.kind === "valuation") continue;
    accounts.add(
      JSON.stringify([
        row.provider.trim().toLowerCase(),
        row.accountName.trim().toLowerCase(),
      ]),
    );
    instruments.add(
      JSON.stringify([
        row.assetClass,
        row.currency,
        row.symbol
          ? ["symbol", row.symbol.trim().toUpperCase()]
          : ["name", row.instrumentName.trim().toUpperCase()],
      ]),
    );
  }
  if (
    accounts.size > importLimits.accounts ||
    instruments.size > importLimits.instruments
  )
    throw new ConvexError("Import exceeds 64 accounts or 512 instruments");
}

export function chunkRows(rows: ReturnType<typeof parseRows>) {
  const chunks: string[] = [];
  let pending: string[] = [];
  let pendingBytes = 2;

  for (const row of rows) {
    const encoded = JSON.stringify(row);
    const rowBytes = utf8Bytes(encoded);
    if (rowBytes + 2 > importLimits.chunkBytes)
      throw new ConvexError("A normalized row exceeds the chunk byte limit");

    if (
      pending.length === importLimits.chunkRows ||
      pendingBytes + rowBytes + Number(pending.length > 0) >
        importLimits.chunkBytes
    ) {
      chunks.push(`[${pending.join(",")}]`);
      pending = [];
      pendingBytes = 2;
    }

    pendingBytes += rowBytes + Number(pending.length > 0);
    pending.push(encoded);
  }

  if (pending.length) chunks.push(`[${pending.join(",")}]`);
  return chunks;
}
