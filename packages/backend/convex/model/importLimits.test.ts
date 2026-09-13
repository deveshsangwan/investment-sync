import { exactNormalizedHoldingRowSchema } from "@investment-sync/importers/exact-types";
import { describe, expect, it } from "vitest";
import {
  chunkRows,
  importLimits,
  parseRows,
  utf8Bytes,
  validateIdentityCapacity,
  storageChecksumToHex,
} from "./importLimits";

const row = exactNormalizedHoldingRowSchema.parse({
  kind: "holding",
  sourceType: "manual_snapshot",
  accountName: "Account",
  provider: "Provider",
  instrumentName: "Instrument",
  assetClass: "indian_stock",
  currency: "INR",
  investedAmount: "10",
  currentValue: "12",
  metadata: {},
  source: {
    group: "Test",
    completeness: "complete",
    granularity: "instrument",
    priority: 0,
  },
  numericProvenance: {},
});

function rowWithEncodedBytes(bytes: number) {
  const candidate = { ...row, metadata: { padding: "" } };
  candidate.metadata.padding = "x".repeat(
    bytes - utf8Bytes(JSON.stringify(candidate)),
  );
  return candidate;
}

describe("import chunk limits", () => {
  it("normalizes the storage checksum to the existing Postgres hex representation", () => {
    expect(
      storageChecksumToHex("n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg="),
    ).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    expect(() => storageChecksumToHex("dGVzdA==")).toThrow(
      "Invalid storage SHA-256 checksum",
    );
  });
  it("keeps 100 rows together and places the 101st in a new chunk", () => {
    const rows = Array.from({ length: 101 }, () => row);
    expect(
      chunkRows(rows.slice(0, 100)).map((chunk) => parseRows(chunk).length),
    ).toEqual([100]);
    const chunks = chunkRows(rows);
    expect(chunks.map((chunk) => parseRows(chunk).length)).toEqual([100, 1]);
    expect(chunks.flatMap(parseRows)).toEqual(rows);
  });

  it("accepts one row at the byte ceiling and rejects one byte above", () => {
    const maximum = rowWithEncodedBytes(importLimits.chunkBytes - 2);
    const [chunk] = chunkRows([maximum]);
    if (!chunk) throw new Error("Expected a chunk");
    expect(utf8Bytes(chunk)).toBe(importLimits.chunkBytes);
    expect(() =>
      chunkRows([rowWithEncodedBytes(importLimits.chunkBytes - 1)]),
    ).toThrow("row exceeds the chunk byte limit");
  });

  it("counts separators and UTF-8 bytes when splitting a chunk", () => {
    const first = rowWithEncodedBytes(32766);
    const second = rowWithEncodedBytes(32767);
    expect(chunkRows([first, second])).toHaveLength(1);
    expect(utf8Bytes(JSON.stringify([first, second]))).toBe(
      importLimits.chunkBytes,
    );
    const larger = {
      ...second,
      metadata: { padding: `${second.metadata.padding}é` },
    };
    expect(chunkRows([first, larger])).toHaveLength(2);
    expect(chunkRows([first, larger]).flatMap(parseRows)).toEqual([
      first,
      larger,
    ]);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkRows([])).toEqual([]);
  });
});

describe("import identity capacity", () => {
  it("accepts 64 distinct accounts and rejects the 65th", () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      ...row,
      accountName: `Account ${index}`,
    }));
    expect(() => validateIdentityCapacity(rows.slice(0, 64))).not.toThrow();
    expect(() => validateIdentityCapacity(rows)).toThrow("64 accounts");
  });

  it("accepts 512 distinct instruments and rejects the 513th", () => {
    const rows = Array.from({ length: 513 }, (_, index) => ({
      ...row,
      instrumentName: `Instrument ${index}`,
    }));
    expect(() => validateIdentityCapacity(rows.slice(0, 512))).not.toThrow();
    expect(() => validateIdentityCapacity(rows)).toThrow("512 instruments");
  });

  it("counts normalized identities once while distinguishing symbol and name", () => {
    const rows = Array.from({ length: 512 }, (_, index) => ({
      ...row,
      instrumentName: `Instrument ${index}`,
    }));
    expect(() =>
      validateIdentityCapacity([
        ...rows,
        {
          ...row,
          accountName: " account ",
          provider: " PROVIDER ",
          instrumentName: " INSTRUMENT 0 ",
        },
      ]),
    ).not.toThrow();
    expect(() =>
      validateIdentityCapacity([...rows, { ...row, symbol: "Instrument 0" }]),
    ).toThrow("512 instruments");
  });
});
