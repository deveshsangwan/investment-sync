"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Id } from "@investment-sync/backend/api";
import { publicImportLimits } from "@investment-sync/backend/import-limits";
import { getImportFileValidationError } from "@investment-sync/importers/import-validation";
import { exactNormalizedImportRowSchema } from "@investment-sync/importers/exact-types";
import { useMutation, useQuery } from "convex/react";

export function useImportWorkflow(isOwner: boolean) {
  const createUpload = useMutation(api.imports.createUpload);
  const attachUpload = useMutation(api.imports.attachUpload);
  const retryParse = useMutation(api.imports.retryParse);
  const commitImport = useMutation(api.imports.commit);
  const [batchId, setBatchId] = useState<Id<"importBatches"> | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCommitPending, setIsCommitPending] = useState(false);
  const [publicationExpectation, setPublicationExpectation] =
    useState<PublicationExpectation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const operationInProgress = useRef(false);
  const operationGeneration = useRef(0);
  const batch = useQuery(api.imports.get, batchId ? { batchId } : "skip");
  const preview = useMemo(
    () => parsePreview(batch?.previewRowsJson),
    [batch?.previewRowsJson],
  );

  useEffect(() => {
    if (isOwner) return;

    generation.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    operationInProgress.current = false;
    operationGeneration.current += 1;
    setIsUploading(false);
    setIsRetrying(false);
    setIsCommitPending(false);
    setPublicationExpectation(null);
  }, [isOwner]);

  useEffect(() => {
    return () => {
      generation.current += 1;
      operationGeneration.current += 1;
      uploadController.current?.abort();
    };
  }, []);

  const publicationOutcome = getPublicationOutcome(
    publicationExpectation,
    batch,
  );
  const isApplying = Boolean(
    isCommitPending ||
    (publicationExpectation && publicationOutcome === "pending"),
  );

  async function upload(file: File) {
    if (operationInProgress.current || !isOwner) return null;

    const validationError = getBrowserImportFileValidationError(file);
    if (validationError) {
      setError(validationError);
      return null;
    }

    const attempt = ++generation.current;
    operationGeneration.current += 1;
    const controller = new AbortController();
    uploadController.current?.abort();
    uploadController.current = controller;
    operationInProgress.current = true;
    setIsUploading(true);
    setError(null);
    setBatchId(null);
    setIsCommitPending(false);
    setPublicationExpectation(null);

    try {
      const mimeType = importMimeType(file);
      const reservation = await createUpload({
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      if (attempt !== generation.current) return null;

      setBatchId(reservation.batchId);
      const response = await fetch(reservation.uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Upload failed. Please try again.");

      const result: unknown = await response.json();
      if (!isStorageUploadResponse(result))
        throw new Error("The upload response was invalid.");
      if (attempt !== generation.current) return null;

      await attachUpload({
        batchId: reservation.batchId,
        storageId: result.storageId,
      });
      return attempt === generation.current ? reservation.batchId : null;
    } catch (cause) {
      if (attempt === generation.current && !controller.signal.aborted)
        setError(errorMessage(cause));
      return null;
    } finally {
      if (attempt === generation.current) {
        operationInProgress.current = false;
        uploadController.current = null;
        setIsUploading(false);
      }
    }
  }

  async function retry(id: Id<"importBatches">) {
    if (operationInProgress.current || !isOwner) return false;

    operationInProgress.current = true;
    const operation = operationGeneration.current;
    setIsRetrying(true);
    setError(null);
    setBatchId(id);

    try {
      await retryParse({ batchId: id });
      return operation === operationGeneration.current;
    } catch (cause) {
      if (operation === operationGeneration.current)
        setError(errorMessage(cause));
      return false;
    } finally {
      if (operation === operationGeneration.current)
        operationInProgress.current = false;
      if (operation === operationGeneration.current) setIsRetrying(false);
    }
  }

  async function apply(id: Id<"importBatches">, previousAttempt: number) {
    if (operationInProgress.current || !isOwner) return null;

    operationInProgress.current = true;
    const operation = operationGeneration.current;
    setBatchId(id);
    setIsCommitPending(true);
    setPublicationExpectation(null);
    setError(null);

    try {
      const result = await commitImport({ batchId: id });
      if (operation !== operationGeneration.current) return null;

      if (result.status === "publishing") {
        setPublicationExpectation({ batchId: id, previousAttempt });
      }
      operationInProgress.current = false;
      setIsCommitPending(false);
      return result;
    } catch (cause) {
      if (operation === operationGeneration.current) {
        setError(errorMessage(cause));
        operationInProgress.current = false;
        setIsCommitPending(false);
      }
      return null;
    }
  }

  function selectBatch(id: Id<"importBatches">) {
    if (operationInProgress.current) return;

    operationGeneration.current += 1;
    setBatchId(id);
    setError(null);
    setIsCommitPending(false);
    setPublicationExpectation(null);
  }

  function reset() {
    generation.current += 1;
    uploadController.current?.abort();
    uploadController.current = null;
    operationInProgress.current = false;
    operationGeneration.current += 1;
    setBatchId(null);
    setError(null);
    setIsUploading(false);
    setIsRetrying(false);
    setIsCommitPending(false);
    setPublicationExpectation(null);
  }

  return {
    batch,
    batchId,
    previewRows: preview.rows,
    isUploading,
    isRetrying,
    isApplying,
    error:
      error ??
      (publicationOutcome === "failed" ? batch?.errorMessage : null) ??
      preview.error,
    upload,
    retry,
    apply,
    selectBatch,
    reset,
  };
}

interface PublicationExpectation {
  batchId: Id<"importBatches">;
  previousAttempt: number;
}

export function getPublicationOutcome(
  expectation: { batchId: string; previousAttempt: number } | null,
  batch:
    | {
        id: string;
        publicationAttempt: number;
        status: string;
        errorMessage: string | null;
      }
    | undefined,
) {
  if (
    !expectation ||
    !batch ||
    batch.id !== expectation.batchId ||
    batch.publicationAttempt <= expectation.previousAttempt
  )
    return "pending" as const;

  if (batch.status === "committed") return "complete" as const;
  if (batch.status === "parsed" && batch.errorMessage) return "failed" as const;
  return "pending" as const;
}

export function getBrowserImportFileValidationError(file: File) {
  if (file.size > publicImportLimits.fileBytes)
    return `Import files must be ${publicImportLimits.fileBytes / 1024} KiB or smaller`;

  return getImportFileValidationError({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}

function parsePreview(previewRowsJson: string | undefined) {
  if (previewRowsJson === undefined) return { rows: [], error: null };

  try {
    return {
      rows: exactNormalizedImportRowSchema
        .array()
        .parse(JSON.parse(previewRowsJson)),
      error: null,
    };
  } catch {
    return { rows: [], error: "The import preview could not be read." };
  }
}

function importMimeType(file: File) {
  if (file.type) return file.type;
  return file.name.toLowerCase().endsWith(".csv")
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
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
  if (
    typeof cause === "object" &&
    cause !== null &&
    "data" in cause &&
    typeof cause.data === "object" &&
    cause.data !== null &&
    "message" in cause.data &&
    typeof cause.data.message === "string"
  )
    return cause.data.message;

  return cause instanceof Error
    ? cause.message
    : "The import could not be completed.";
}
