const MAX_COLLECTION_SKEW_MS = 24 * 60 * 60 * 1000;

function evaluateCapacityEvidence({ runId, postgres, storage, dispositions }) {
  const compatibilityErrors = validateCompatibility(runId, postgres, storage);
  const dispositionMap = validateDispositions(runId, dispositions);
  const findings = collectFindings(postgres, storage).map((finding) => ({
    ...finding,
    disposition: dispositionMap.get(finding.check) ?? null,
  }));
  const unresolvedFindings = findings.filter(
    (finding) => finding.count > 0 && finding.disposition === null,
  );
  const coherentProfile = coherentLargestProfile(postgres, storage);
  const transportProfile = largestAvailableTransportProfile(storage);
  const evidenceReady =
    compatibilityErrors.length === 0 &&
    storage.status === "complete" &&
    coherentProfile !== null &&
    transportProfile !== null &&
    unresolvedFindings.length === 0;

  return {
    compatibilityErrors,
    findings,
    unresolvedFindings,
    coherentProfile,
    transportProfile,
    candidate: evidenceReady
      ? candidateCeilings(coherentProfile, transportProfile)
      : null,
    twiceLargest: coherentProfile ? twiceLargestFixture(coherentProfile) : null,
    twiceLargestTransport: transportProfile
      ? { compressedBytes: transportProfile.compressedBytes * 2 }
      : null,
    pending: pendingBreakdown(postgres.pendingBatches ?? []),
    largestHousehold: postgres.largestHousehold ?? null,
    evidenceReady,
  };
}

function validateCompatibility(runId, postgres, storage) {
  const errors = [];
  if (postgres.schemaVersion !== 1) errors.push("unsupported_postgres_schema");
  if (storage.schemaVersion !== 2) errors.push("unsupported_storage_schema");
  if (postgres.runId !== runId || storage.runId !== runId) {
    errors.push("run_id_mismatch");
  }
  if (
    !postgres.databaseFingerprint ||
    postgres.databaseFingerprint !== storage.databaseFingerprint
  ) {
    errors.push("database_fingerprint_mismatch");
  }
  if (storage.status === "complete" && !storage.storageFingerprint) {
    errors.push("missing_storage_fingerprint");
  }

  const postgresTime = Date.parse(postgres.collectedAt);
  const storageTime = Date.parse(storage.collectedAt);
  if (!Number.isFinite(postgresTime) || !Number.isFinite(storageTime)) {
    errors.push("invalid_collection_timestamp");
  } else if (
    storageTime < postgresTime ||
    storageTime - postgresTime > MAX_COLLECTION_SKEW_MS
  ) {
    errors.push("incompatible_collection_timestamp");
  }
  return errors;
}

function validateDispositions(runId, dispositions) {
  const result = new Map();
  if (dispositions === null) return result;
  if (dispositions.schemaVersion !== 1 || dispositions.runId !== runId) {
    throw new Error(
      "Disposition manifest is incompatible with the inventory run",
    );
  }
  for (const item of dispositions.findings ?? []) {
    if (
      !/^[a-z0-9_]{1,80}$/.test(item.check) ||
      item.disposition !== "accepted_source_state" ||
      !/^[a-z0-9_]{1,80}$/.test(item.reasonCode)
    ) {
      throw new Error(
        "Disposition manifest contains unsafe or unsupported content",
      );
    }
    result.set(item.check, {
      disposition: item.disposition,
      reasonCode: item.reasonCode,
    });
  }
  return result;
}

function collectFindings(postgres, storage) {
  const pending = pendingBreakdown(postgres.pendingBatches ?? []);
  const findings = [
    ...(postgres.integrity ?? []).map((item) => ({
      check: item.check,
      count: item.groups,
    })),
    ...(postgres.collisions ?? []).map((item) => ({
      check: item.check,
      count: item.groups,
    })),
    { check: "pending_empty_expired_batches", count: pending.emptyExpired },
  ];
  if (storage.status === "complete") {
    const summary = storage.summary;
    for (const [check, count] of [
      ["storage_missing_files", summary.missingFiles],
      ["storage_download_failures", summary.downloadFailures],
      ["storage_hash_mismatches", summary.hashMismatches],
      ["storage_size_mismatches", summary.storageSizeMismatches],
      ["storage_parse_failures", summary.parseFailures],
      ["storage_row_count_mismatches", summary.databaseRowCountMismatches],
      ["storage_orphan_bucket_objects", summary.orphanBucketObjects],
    ]) {
      findings.push({ check, count });
    }
  }
  return findings;
}

function coherentLargestProfile(postgres, storage) {
  const persisted = postgres.largestBatch;
  if (
    !persisted ||
    !persisted.batchFingerprint ||
    !persisted.sourceType ||
    !Array.isArray(persisted.rowKindCounts) ||
    !Array.isArray(persisted.currencyCounts) ||
    !Number.isFinite(persisted.projectedFactWritesLowerBound) ||
    !Number.isFinite(persisted.projectedReadModelWritesLowerBound)
  ) {
    return null;
  }
  const available =
    storage.status === "complete"
      ? storage.files?.find(
          (file) =>
            file.batchFingerprint === persisted.batchFingerprint &&
            file.availability === "available" &&
            file.parseStatus === "parsed",
        )
      : null;
  return {
    sourceType: persisted.sourceType,
    normalizedRows: persisted.normalizedRows,
    normalizedSerializedBytes: persisted.normalizedSerializedBytes,
    compressedBytes: available?.downloadedBytes ?? null,
    distinctAccounts: persisted.distinctAccounts,
    distinctInstruments: persisted.distinctInstruments,
    projectedFactWritesLowerBound: persisted.projectedFactWritesLowerBound,
    projectedReadModelWritesLowerBound:
      persisted.projectedReadModelWritesLowerBound,
    rowKindCounts: persisted.rowKindCounts,
    currencyCounts: persisted.currencyCounts,
  };
}

function largestAvailableTransportProfile(storage) {
  if (storage.status !== "complete") return null;

  const availableFiles = (storage.files ?? []).filter(
    (file) =>
      file.availability === "available" &&
      file.parseStatus === "parsed" &&
      Number.isFinite(file.downloadedBytes),
  );
  if (availableFiles.length === 0) return null;

  const largest = availableFiles.reduce((current, file) =>
    file.downloadedBytes > current.downloadedBytes ? file : current,
  );
  return { compressedBytes: largest.downloadedBytes };
}

function candidateCeilings(profile, transportProfile = profile) {
  return {
    compressedBytes: Math.min(
      ceiling(transportProfile.compressedBytes, 1.5, 262_144),
      4 * 1024 * 1024,
    ),
    normalizedRows: ceiling(profile.normalizedRows, 1.5, 100),
    normalizedSerializedBytes: ceiling(
      profile.normalizedSerializedBytes,
      1.5,
      65_536,
    ),
  };
}

function twiceLargestFixture(profile) {
  return {
    sourceType: profile.sourceType,
    compressedBytes:
      profile.compressedBytes === null ? null : profile.compressedBytes * 2,
    normalizedRows: profile.normalizedRows * 2,
    normalizedSerializedBytes: profile.normalizedSerializedBytes * 2,
    distinctAccounts: profile.distinctAccounts * 2,
    distinctInstruments: profile.distinctInstruments * 2,
    projectedFactWritesLowerBound: profile.projectedFactWritesLowerBound * 2,
    projectedReadModelWritesLowerBound:
      profile.projectedReadModelWritesLowerBound * 2,
    rowKindCounts: doubleCounts(profile.rowKindCounts),
    currencyCounts: doubleCounts(profile.currencyCounts),
  };
}

function pendingBreakdown(groups) {
  const result = { meaningfulExpired: 0, emptyExpired: 0, other: 0 };
  for (const group of groups) {
    if (group.key.endsWith("/meaningful/expired")) {
      result.meaningfulExpired += group.count;
    } else if (group.key.endsWith("/empty/expired")) {
      result.emptyExpired += group.count;
    } else {
      result.other += group.count;
    }
  }
  return result;
}

function ceiling(value, multiplier, unit) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.ceil((value * multiplier) / unit) * unit;
}

function doubleCounts(groups) {
  return groups.map((group) => ({ key: group.key, count: group.count * 2 }));
}

module.exports = {
  candidateCeilings,
  evaluateCapacityEvidence,
  pendingBreakdown,
  validateCompatibility,
};
