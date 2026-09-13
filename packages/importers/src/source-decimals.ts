import type { NormalizedImportRow } from "./types";

// Keep raw cells out of the legacy JSON contract. The exact parser consumes
// them synchronously before rows cross a serialization boundary.
const sourceCells = new WeakMap<NormalizedImportRow, Record<string, unknown>>();

export function withSourceDecimals<T extends NormalizedImportRow>(
  row: T,
  cells: Record<string, unknown>,
): T {
  sourceCells.set(row, cells);
  return row;
}

export function getSourceDecimals(row: NormalizedImportRow) {
  return sourceCells.get(row);
}
