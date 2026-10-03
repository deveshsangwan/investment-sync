export interface CountGroup {
  key: string;
  count: number;
}

export interface CheckSummary {
  check: string;
  groups: number;
  excessRecords: number;
  maximumGroupSize: number;
}

export interface BatchCapacitySummary {
  batchFingerprint: string;
  sourceType: string;
  normalizedRows: number;
  normalizedSerializedBytes: number;
  maximumNormalizedRowBytes: number;
  distinctAccounts: number;
  distinctInstruments: number;
  projectedFactWritesLowerBound: number;
  projectedReadModelWritesLowerBound: number;
  rowKindCounts: CountGroup[];
  currencyCounts: CountGroup[];
}

export interface PostgresInventory {
  schemaVersion: 1;
  runId: string;
  collectedAt: string;
  sourceFingerprint: string;
  databaseFingerprint: string;
  tableCounts: CountGroup[];
  batchStatuses: CountGroup[];
  batchSources: CountGroup[];
  rowKinds: CountGroup[];
  currencies: Record<string, CountGroup[]>;
  collisions: CheckSummary[];
  integrity: CheckSummary[];
  prices: { records: number; groups: CountGroup[] };
  sourceFiles: {
    referenced: number;
    expiredReferenced: number;
    unexpiredReferenced: number;
  };
  pendingBatches: CountGroup[];
  largestBatch: BatchCapacitySummary | null;
  largestHousehold: {
    accounts: number;
    instruments: number;
    importBatches: number;
    importRows: number;
    holdingSnapshots: number;
    transactions: number;
    valuations: number;
    factRows: number;
  } | null;
  reconciliationFindings: { batchRowCountMismatches: number };
}

export interface StorageInventory {
  schemaVersion: 2;
  runId: string;
  collectedAt: string;
  status: "complete" | "blocked";
  reason?: string;
  databaseFingerprint: string;
  storageFingerprint: string | null;
  summary?: {
    referencedFiles: number;
    bucketObjects: number;
    orphanBucketObjects: number;
    availableFiles: number;
    missingFiles: number;
    downloadFailures: number;
    hashMismatches: number;
    storageSizeMismatches: number;
    databaseSizeUnverifiable: number;
    parseFailures: number;
    databaseRowCountMismatches: number;
    compressedBytes: CapacityRange;
    normalizedRows: CapacityRange;
    normalizedSerializedBytes: CapacityRange;
    maximumDistinctAccounts: number;
    maximumDistinctInstruments: number;
    maximumProjectedFactWrites: number;
    maximumProjectedReadModelWrites: number;
    largestAvailableFileProfile: null | {
      sourceType: string;
      normalizedRows: number;
      normalizedSerializedBytes: number;
      compressedBytes: number;
      distinctAccounts: number;
      distinctInstruments: number;
      projectedFactWritesLowerBound: number;
      projectedReadModelWritesLowerBound: number;
      rowKindCounts: CountGroup[];
      currencyCounts: CountGroup[];
    };
  };
}

export interface CapacityRange {
  minimum: number;
  maximum: number;
}
