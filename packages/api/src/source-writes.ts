import { isSourceWritesPaused } from "./config";

export class SourceWritesPausedError extends Error {
  constructor() {
    super("Source writes are paused");
    this.name = "SourceWritesPausedError";
  }
}

// Recheck at side-effect boundaries. Requests that already passed a check must
// still be drained before a snapshot; this switch cannot cancel issued writes.
export function assertSourceWritesAllowed() {
  if (isSourceWritesPaused()) {
    throw new SourceWritesPausedError();
  }
}
