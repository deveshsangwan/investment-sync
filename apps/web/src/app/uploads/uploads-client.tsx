"use client";

import { useRef, useState, type DragEvent } from "react";
import { api, type Id } from "@investment-sync/backend/api";
import { publicImportLimits } from "@investment-sync/backend/import-limits";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Check, FileSpreadsheet, LoaderCircle, Upload, X } from "lucide-react";
import Link from "next/link";
import { useAmountsVisibility } from "@/components/amounts";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  Panel,
} from "@/components/portfolio-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  labelize,
  sourceLabel,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getBrowserImportFileValidationError,
  useImportWorkflow,
} from "@/features/imports/use-import-workflow";
import { ConvexSessionGate } from "../convex-provider";
import { ConvexQueryBoundary } from "@/components/convex-query-boundary";

type FlowStep = "select" | "review" | "apply" | "done";
type PreviewRow = Record<string, unknown>;

interface ImportPreview {
  importBatchId: Id<"importBatches">;
  originalFileName: string;
  sourceType?: string;
  rowCount: number;
  warnings: string[];
  rows: PreviewRow[];
  publicationAttempt: number;
}

const flowSteps: Array<{ value: FlowStep; label: string }> = [
  { value: "select", label: "Select file" },
  { value: "review", label: "Review data" },
  { value: "apply", label: "Apply" },
  { value: "done", label: "Done" },
];

const sourceGuidance = [
  {
    title: "NPS",
    format: "CSV",
    description:
      "Download the Tier I transaction statement from the NPS portal.",
  },
  {
    title: "Tickertape",
    format: "CSV",
    description:
      "Export the holdings file from either the Stocks or Mutual Funds portfolio tab.",
  },
  {
    title: "Vested / DriveWealth",
    format: "XLSX",
    description:
      "Use the P&L workbook that includes the Unrealized P&L - Summary sheet.",
  },
  {
    title: "Portfolio workbook",
    format: "XLSX",
    description:
      "Upload your investment workbook with summary and asset-specific sheets.",
  },
] as const;

export function UploadsRoute() {
  return (
    <PageShell>
      <ConvexSessionGate loading={<UploadsLoading />}>
        <ConvexQueryBoundary
          title="Imports could not be loaded"
          description="Your existing imports are unchanged. Try loading the page again."
        >
          <UploadsClient />
        </ConvexQueryBoundary>
      </ConvexSessionGate>
    </PageShell>
  );
}

function UploadsLoading() {
  return (
    <>
      <PageHeader
        title="Imports"
        description="Select a statement, check what was detected, then apply it. Nothing changes in your portfolio until you apply."
      />
      <Panel title="Select a portfolio export">
        <Skeleton
          className="h-56 rounded-2xl"
          aria-label="Preparing import access"
        />
      </Panel>
    </>
  );
}

export function UploadsClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<FlowStep>("select");
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [appliedRowCount, setAppliedRowCount] = useState<number | null>(null);
  const current = useQuery(api.users.current);
  const list = usePaginatedQuery(api.imports.list, {}, { initialNumItems: 20 });
  const hasUploadPermission = current?.role === "owner";
  const workflow = useImportWorkflow(hasUploadPermission);
  const isPublishing = workflow.batch?.status === "publishing";
  const isBusy =
    workflow.isUploading ||
    workflow.isRetrying ||
    workflow.isApplying ||
    isPublishing;
  const isPreparing = workflow.isUploading || workflow.isRetrying;
  const canUpload = Boolean(
    hasUploadPermission && file && !fileError && !isBusy,
  );
  const batchPreview = workflow.batch
    ? importPreview(workflow.batch, workflow.previewRows)
    : null;
  const displayedPreview = batchPreview ?? preview;
  const visibleStep =
    step === "apply" && workflow.batch?.status === "committed" ? "done" : step;
  const failedBatch =
    workflow.batch?.status === "failed" ? workflow.batch : null;

  const resetFlow = () => {
    setFile(null);
    setStep("select");
    setFileError(null);
    setPreview(null);
    setAppliedRowCount(null);
    setIsDragging(false);
    workflow.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseAnotherFile = () => {
    resetFlow();
    inputRef.current?.click();
  };

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    workflow.reset();
    setPreview(null);
    setAppliedRowCount(null);

    if (!selectedFile) {
      setFileError(null);
      return;
    }

    const validationError = getBrowserImportFileValidationError(selectedFile);
    setFileError(validationError);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy || !hasUploadPermission) return;
    handleFileChange(event.dataTransfer.files[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file || !hasUploadPermission || isBusy) return;
    const validationError = getBrowserImportFileValidationError(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }

    setFileError(null);
    const batchId = await workflow.upload(file);
    if (batchId) {
      setFile(null);
      setStep("review");
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleApply = (
    importBatchId: Id<"importBatches">,
    publicationAttempt: number,
    nextPreview?: ImportPreview,
  ) => {
    if (!hasUploadPermission || isBusy) return;

    if (nextPreview) setPreview(nextPreview);
    workflow.selectBatch(importBatchId);
    setAppliedRowCount(null);
    setStep("apply");
    void workflow.apply(importBatchId, publicationAttempt).then((result) => {
      if (result?.status === "committed")
        setAppliedRowCount(
          nextPreview?.rowCount ?? displayedPreview?.rowCount ?? null,
        );
    });
  };

  return (
    <>
      <PageHeader
        title="Imports"
        description="Select a statement, check what was detected, then apply it. Nothing changes in your portfolio until you apply."
        meta={
          <p className="text-xs text-muted-foreground">
            Source files are kept for 30 days. Import history stays available
            after a file expires.
          </p>
        }
      />

      <>
        <input
          ref={inputRef}
          id="portfolio-file"
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          disabled={isBusy || !hasUploadPermission}
          onChange={(event) =>
            handleFileChange(event.target.files?.[0] ?? null)
          }
        />

        {!current ? (
          <Panel title="Select a portfolio export">
            <Skeleton
              className="h-56 rounded-2xl"
              aria-label="Loading import permissions"
            />
          </Panel>
        ) : !hasUploadPermission ? (
          <Alert>
            <AlertTitle>Only household owners can import files</AlertTitle>
            <AlertDescription>
              You can view the import history for this household below.
            </AlertDescription>
          </Alert>
        ) : null}

        {hasUploadPermission ? (
          <ImportProgress currentStep={visibleStep} />
        ) : null}

        {hasUploadPermission && visibleStep === "select" ? (
          <Panel title="Select a portfolio export" bodyClassName="space-y-4">
            <div
              className={cn(
                "rounded-2xl border border-dashed border-border/80 px-5 py-10 text-center transition-colors duration-150 motion-reduce:transition-none",
                isDragging && "border-foreground/50 bg-secondary/60",
                fileError && "border-negative/50",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!isBusy && hasUploadPermission) setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <Upload
                className="mx-auto size-5 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium">
                Drop a CSV or XLSX file here
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Supported exports are detected automatically. Files up to{" "}
                {publicImportLimits.fileBytes / 1024} KiB, with at most{" "}
                {publicImportLimits.rows.toLocaleString("en-IN")} normalized
                rows and {publicImportLimits.normalizedBytes / 1024} KiB of
                normalized data.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                disabled={isBusy}
                onClick={() => inputRef.current?.click()}
              >
                Browse files
              </Button>
            </div>

            {file ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-border/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <FileSpreadsheet
                    className="size-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="number mt-0.5 text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${file.name}`}
                  disabled={isBusy}
                  onClick={() => handleFileChange(null)}
                >
                  <X aria-hidden="true" />
                  Remove
                </Button>
              </div>
            ) : null}

            {fileError ? (
              <p role="alert" className="text-sm font-medium text-negative">
                {fileError}
              </p>
            ) : null}

            {workflow.error ? (
              <Alert className="border-negative/40">
                <AlertTitle>This file could not be prepared</AlertTitle>
                <AlertDescription>{workflow.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={!canUpload} onClick={() => void handleUpload()}>
                {workflow.isUploading ? (
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {workflow.isUploading ? "Preparing review" : "Review file"}
              </Button>
            </div>
          </Panel>
        ) : null}

        {hasUploadPermission &&
        visibleStep === "review" &&
        displayedPreview &&
        workflow.batch?.status === "parsed" ? (
          <ReviewImport
            preview={displayedPreview}
            onChooseAnother={chooseAnotherFile}
            onApply={() =>
              handleApply(
                displayedPreview.importBatchId,
                displayedPreview.publicationAttempt,
              )
            }
          />
        ) : null}

        {hasUploadPermission &&
        visibleStep === "review" &&
        (isPreparing ||
          !workflow.batch ||
          ["awaiting_upload", "uploaded", "parsing"].includes(
            workflow.batch.status,
          )) ? (
          <Panel
            title="Preparing review"
            description="The source file is being parsed and checked against the import limits."
          >
            <div role="status" className="flex items-center gap-3">
              <LoaderCircle
                className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                Keep this page open while the preview is prepared.
              </p>
            </div>
          </Panel>
        ) : null}

        {hasUploadPermission &&
        visibleStep === "review" &&
        !workflow.isRetrying &&
        failedBatch ? (
          <div className="space-y-3">
            <ErrorState
              title="This file could not be prepared"
              description={
                failedBatch.errorMessage ??
                "The parser could not read this file."
              }
              onRetry={
                failedBatch.fileAvailable
                  ? () => void workflow.retry(failedBatch.id)
                  : undefined
              }
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={chooseAnotherFile}>
                Choose another file
              </Button>
            </div>
          </div>
        ) : null}

        {hasUploadPermission && visibleStep === "apply" && displayedPreview ? (
          <Panel
            title={workflow.error ? "Import not applied" : "Applying import"}
            description={
              workflow.error
                ? "Your existing portfolio data has not changed."
                : "The reviewed rows are being added to your portfolio."
            }
          >
            {workflow.error ? (
              <ErrorState
                title="This import could not be applied"
                description={workflow.error}
                onRetry={() =>
                  handleApply(
                    displayedPreview.importBatchId,
                    displayedPreview.publicationAttempt,
                  )
                }
              />
            ) : (
              <div
                role="status"
                className="flex items-center gap-3 rounded-2xl border border-border/70 p-5"
              >
                <LoaderCircle
                  className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium">
                    Applying {displayedPreview.rowCount.toLocaleString("en-IN")}{" "}
                    rows
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep this page open until the import finishes.
                  </p>
                </div>
              </div>
            )}
          </Panel>
        ) : null}

        {hasUploadPermission && visibleStep === "done" && displayedPreview ? (
          <Panel title="Import applied">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Check
                  className="mt-0.5 size-5 shrink-0 text-positive"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium">
                    {sourceLabel(displayedPreview.sourceType)} data is now in
                    your portfolio
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {(
                      appliedRowCount ?? displayedPreview.rowCount
                    ).toLocaleString("en-IN")}{" "}
                    normalized rows were applied from{" "}
                    {displayedPreview.originalFileName}.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="outline" onClick={resetFlow}>
                  Import another
                </Button>
                <Button asChild>
                  <Link href="/dashboard">View portfolio</Link>
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}

        <section className="mt-8">
          <h2 className="text-[0.82rem] font-semibold">Supported exports</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the original export without renaming sheets or editing column
            headings.
          </p>
          <dl className="mt-3 divide-y divide-border/70 border-y border-border/70">
            {sourceGuidance.map((source) => (
              <div
                key={source.title}
                className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
              >
                <dt className="text-sm font-medium">{source.title}</dt>
                <dd className="text-sm leading-6 text-muted-foreground">
                  {source.description}
                </dd>
                <dd className="text-xs text-muted-foreground sm:text-right">
                  {source.format}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-8">
          <h2 className="text-[0.82rem] font-semibold">Recent imports</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Import records stay visible after the original file reaches its
            30-day retention date.
          </p>

          <div className="mt-3">
            {list.status === "LoadingFirstPage" ? (
              <ImportHistorySkeleton />
            ) : list.results.length === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="No imports yet"
                description="Select a supported portfolio export to create your first import."
              />
            ) : (
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {list.results.map((batch) => {
                  const batchWorkflow = historyWorkflow(batch);
                  const retention = historyRetention(batch);
                  const canApply =
                    hasUploadPermission &&
                    !batch.committedAt &&
                    batch.rowCount > 0 &&
                    batch.status === "parsed";
                  const historyPreview: ImportPreview = {
                    importBatchId: batch.id,
                    originalFileName: batch.fileName,
                    sourceType: batch.sourceType ?? undefined,
                    rowCount: batch.rowCount,
                    warnings: batch.warnings,
                    rows: parsePreviewRows(batch.previewRowsJson),
                    publicationAttempt: batch.publicationAttempt,
                  };

                  return (
                    <li key={batch.id} className="py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {batch.fileName}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {sourceLabel(batch.sourceType)} · uploaded{" "}
                            {formatDate(batch.createdAt)} ·{" "}
                            {batch.rowCount.toLocaleString("en-IN")} normalized
                            rows
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {retention.label}
                            {batch.warnings.length > 0
                              ? ` · ${batch.warnings.length} warning${
                                  batch.warnings.length === 1 ? "" : "s"
                                }`
                              : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={batchWorkflow.variant}>
                            {batchWorkflow.label}
                          </Badge>
                          {hasUploadPermission &&
                          batch.status === "failed" &&
                          batch.fileAvailable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => {
                                setPreview(historyPreview);
                                setStep("review");
                                void workflow.retry(batch.id);
                              }}
                            >
                              Retry parsing
                            </Button>
                          ) : null}
                          {canApply ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() =>
                                handleApply(
                                  batch.id,
                                  batch.publicationAttempt,
                                  historyPreview,
                                )
                              }
                            >
                              {isBusy && workflow.batchId === batch.id
                                ? "Applying"
                                : "Apply import"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {batch.errorMessage ? (
                        <p
                          role="alert"
                          className="mt-2 text-xs leading-5 text-negative"
                        >
                          {batch.errorMessage}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {list.status === "CanLoadMore" ? (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => list.loadMore(20)}
              >
                Load more
              </Button>
            ) : null}
          </div>
        </section>
      </>
    </>
  );
}

function ImportProgress({ currentStep }: { currentStep: FlowStep }) {
  const currentIndex = flowSteps.findIndex(
    (flowStep) => flowStep.value === currentStep,
  );

  return (
    <nav aria-label="Import progress" className="mb-5">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {flowSteps.map((flowStep, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <li
              key={flowStep.value}
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-center gap-3"
            >
              <span
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1 transition-colors duration-150 motion-reduce:transition-none",
                  isCurrent && "bg-secondary font-medium text-foreground",
                  !isCurrent && "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 place-items-center rounded-full border text-[0.6rem]",
                    isComplete
                      ? "border-foreground/50 text-foreground"
                      : isCurrent
                        ? "border-foreground bg-foreground text-background"
                        : "border-border",
                  )}
                >
                  {isComplete ? <Check className="size-2.5" /> : index + 1}
                </span>
                {flowStep.label}
              </span>
              {index < flowSteps.length - 1 ? (
                <span aria-hidden="true" className="h-px w-4 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ReviewImport({
  preview,
  onChooseAnother,
  onApply,
}: {
  preview: ImportPreview;
  onChooseAnother: () => void;
  onApply: () => void;
}) {
  const { isHidden } = useAmountsVisibility();

  return (
    <Panel
      title="Review detected data"
      description="Check the source, row count, warnings, and sample rows before applying."
      bodyClassName="space-y-5"
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">File</dt>
          <dd className="mt-1 truncate text-sm font-medium">
            {preview.originalFileName}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Detected source</dt>
          <dd className="mt-1 text-sm font-medium">
            {sourceLabel(preview.sourceType)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Normalized rows</dt>
          <dd className="number mt-1 text-sm font-medium">
            {preview.rowCount.toLocaleString("en-IN")}
          </dd>
        </div>
      </dl>

      {preview.warnings.length > 0 ? (
        <Alert className="border-foreground/30">
          <AlertTitle>
            {preview.warnings.length} import warning
            {preview.warnings.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {preview.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          The parser found nothing that needs your attention.
        </p>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">Sample rows</h3>
          <p className="number text-xs text-muted-foreground">
            {Math.min(preview.rows.length, preview.rowCount)} of{" "}
            {preview.rowCount.toLocaleString("en-IN")}
          </p>
        </div>
        {preview.rows.length > 0 ? (
          <ul className="mt-2 divide-y divide-border/70 border-y border-border/70">
            {preview.rows.map((row, index) => {
              const summary = summarizePreviewRow(row);
              return (
                <li
                  key={index}
                  className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-baseline gap-3 py-3"
                >
                  <span className="text-xs text-muted-foreground">
                    {summary.kind}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {summary.title}
                    </span>
                    {summary.detail ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {summary.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="number text-sm font-medium">
                    {isHidden && summary.value
                      ? "••••••"
                      : (summary.value ?? "")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No normalized rows were returned for preview.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-5 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onChooseAnother}>
          Choose another file
        </Button>
        <Button disabled={preview.rowCount === 0} onClick={onApply}>
          Apply import
        </Button>
      </div>
    </Panel>
  );
}

function ImportHistorySkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading import history"
      className="space-y-3"
    >
      <span className="sr-only">Loading import history</span>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2 py-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function historyWorkflow(batch: {
  status: string;
  committedAt: number | null;
  processedAt: number | null;
  errorMessage: string | null;
}) {
  if (batch.committedAt || batch.status === "committed") {
    return { label: "Applied", variant: "positive" as const };
  }
  if (batch.status === "failed" || batch.errorMessage) {
    return { label: "Needs attention", variant: "negative" as const };
  }
  if (batch.status === "publishing") {
    return { label: "Applying", variant: "secondary" as const };
  }
  if (batch.status === "parsed" || batch.processedAt) {
    return { label: "Ready to apply", variant: "warning" as const };
  }
  if (
    batch.status === "awaiting_upload" ||
    batch.status === "uploaded" ||
    batch.status === "parsing"
  ) {
    return { label: "Preparing", variant: "secondary" as const };
  }
  return { label: "Not applied", variant: "outline" as const };
}

function historyRetention(batch: {
  status: string;
  fileAvailable: boolean;
  expiresAt: number;
  processedAt: number | null;
}) {
  if (!batch.fileAvailable) {
    return {
      label: batch.processedAt
        ? "Source file expired · portfolio data retained"
        : "Source file unavailable",
    };
  }
  return { label: `Source file kept until ${formatDate(batch.expiresAt)}` };
}

function importPreview(
  batch: {
    id: Id<"importBatches">;
    fileName: string;
    sourceType: string | null;
    rowCount: number;
    warnings: string[];
    publicationAttempt: number;
  },
  rows: PreviewRow[],
): ImportPreview {
  return {
    importBatchId: batch.id,
    originalFileName: batch.fileName,
    sourceType: batch.sourceType ?? undefined,
    rowCount: batch.rowCount,
    warnings: batch.warnings,
    rows,
    publicationAttempt: batch.publicationAttempt,
  };
}

function parsePreviewRows(value: string): PreviewRow[] {
  try {
    const rows: unknown = JSON.parse(value);
    return Array.isArray(rows) ? rows.filter(isPreviewRow) : [];
  } catch {
    return [];
  }
}

function summarizePreviewRow(row: PreviewRow) {
  const kind = readString(row.kind);
  const currency = readString(row.currency);

  if (kind === "holding") {
    const quantity = readNumber(row.quantity);
    return {
      kind: "Holding",
      title: readString(row.instrumentName) ?? "Portfolio holding",
      detail: [
        readString(row.accountName),
        readableValue(row.assetClass),
        quantity === undefined
          ? undefined
          : `${formatQuantity(quantity)} units`,
      ]
        .filter(Boolean)
        .join(" · "),
      value: formatPreviewCurrency(row.currentValue, currency),
    };
  }

  if (kind === "transaction") {
    return {
      kind: "Transaction",
      title: readString(row.instrumentName) ?? "Portfolio transaction",
      detail: [
        readableValue(row.type),
        safeFormatDate(row.tradeDate),
        readString(row.accountName),
      ]
        .filter(Boolean)
        .join(" · "),
      value: formatPreviewCurrency(row.amount, currency),
    };
  }

  if (kind === "valuation") {
    return {
      kind: "Valuation",
      title: "Portfolio valuation",
      detail: safeFormatDate(row.valuationDate),
      value: formatPreviewCurrency(row.currentValue, currency),
    };
  }

  return {
    kind: kind ? labelize(kind) : "Row",
    title: readString(row.instrumentName) ?? "Normalized import row",
    detail: readString(row.accountName),
    value: undefined,
  };
}

function isPreviewRow(value: unknown): value is PreviewRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readableValue(value: unknown) {
  const text = readString(value);
  return text ? labelize(text) : undefined;
}

function safeFormatDate(value: unknown) {
  const date = readString(value);
  if (!date || Number.isNaN(new Date(date).getTime())) return undefined;
  return formatDate(date);
}

function formatPreviewCurrency(value: unknown, currency?: string) {
  const amount = readNumber(value);
  return amount === undefined ? undefined : formatCurrency(amount, currency);
}

function formatFileSize(sizeBytes: number) {
  const megabytes = sizeBytes / (1024 * 1024);
  return `${megabytes < 0.1 ? megabytes.toFixed(2) : megabytes.toFixed(1)} MB`;
}
