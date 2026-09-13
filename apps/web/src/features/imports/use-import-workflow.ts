"use client";

import { useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api, type Id } from "@investment-sync/backend/api";
import { getImportFileValidationError } from "@investment-sync/importers";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";

export function useImportWorkflow() {
  const { isAuthenticated } = useConvexAuth();
  const createUpload = useMutation(api.imports.createUpload);
  const attachUpload = useMutation(api.imports.attachUpload);
  const retryParse = useMutation(api.imports.retryParse);
  const [batchId, setBatchId] = useState<Id<"importBatches"> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const batch = useQuery(
    api.imports.get,
    isAuthenticated && batchId ? { batchId } : "skip",
  );
  const preview = useMemo(() => {
    try {
      const rows = exactNormalizedImportRowSchema
        .array()
        .parse(JSON.parse(batch?.previewRowsJson ?? "[]"));
      return { rows, error: null };
    } catch {
      return { rows: [], error: "The import preview could not be read." };
    }
  }, [batch?.previewRowsJson]);

  async function upload(file: File) {
    if (busy.current || !isAuthenticated) return;

    const validationError = getImportFileValidationError({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (validationError || file.size > 262144) {
      setError(validationError ?? "Import files must be 256 KiB or smaller");
      return;
    }

    const attempt = ++generation.current;
    busy.current = true;
    setIsUploading(true);
    setError(null);
    setBatchId(null);

    try {
      const reservation = await createUpload({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (attempt !== generation.current) return;

      setBatchId(reservation.batchId);
      const response = await fetch(reservation.uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type":
            file.type ||
            (file.name.toLowerCase().endsWith(".csv")
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed. Please try again.");

      const result: unknown = await response.json();
      if (!isStorageUploadResponse(result))
        throw new Error("The upload response was invalid.");

      await attachUpload({
        batchId: reservation.batchId,
        storageId: result.storageId,
      });
    } catch (cause) {
      if (attempt === generation.current) setError(errorMessage(cause));
    } finally {
      busy.current = false;
      if (attempt === generation.current) setIsUploading(false);
    }
  }

  async function retry(id: Id<"importBatches">) {
    setError(null);
    setBatchId(id);

    try {
      await retryParse({ batchId: id });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function reset() {
    generation.current += 1;
    setBatchId(null);
    setError(null);
    setIsUploading(false);
  }

  return {
    batch,
    batchId,
    previewRows: preview.rows,
    isUploading,
    error: error ?? preview.error,
    upload,
    retry,
    reset,
  };
}

function isStorageUploadResponse(
  value: unknown,
): value is { storageId: Id<"_storage"> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "storageId" in value &&
    typeof value.storageId === "string" &&
    value.storageId.length > 0
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The import could not be completed.";
}
