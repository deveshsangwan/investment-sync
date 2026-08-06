"use client";

import { useRef, useState, type DragEvent } from "react";
import { getImportFileValidationError } from "@investment-sync/importers";
import {
  Check,
  CheckCircle2,
  FileSpreadsheet,
  LoaderCircle,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { SetupRequired } from "@/components/dashboard-states";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  SectionCard,
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
import { trpc } from "../providers";

type FlowStep = "select" | "review" | "apply" | "done";
type UploadStatus = "idle" | "uploading" | "error";
type PreviewRow = Record<string, unknown>;

interface ImportPreview {
  importBatchId: string;
  originalFileName: string;
  sourceType?: string;
  rowCount: number;
  warnings: string[];
  rows: PreviewRow[];
}

const flowSteps: Array<{ value: FlowStep; label: string }> = [
  { value: "select", label: "Select" },
  { value: "review", label: "Review" },
  { value: "apply", label: "Apply" },
  { value: "done", label: "Done" },
];

const sourceGuidance = [
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

export function UploadsClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<FlowStep>("select");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [appliedRowCount, setAppliedRowCount] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const list = trpc.imports.list.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const commit = trpc.imports.commit.useMutation({
    onSuccess: (result) => {
      setAppliedRowCount(result.committed);
      setStep("done");
      void utils.imports.list.invalidate();
      void utils.portfolio.overview.invalidate();
      void utils.portfolio.summary.invalidate();
      void utils.portfolio.holdings.invalidate();
      void utils.portfolio.positions.invalidate();
    },
  });

  const isBusy = status === "uploading" || commit.isLoading;
  const canUpload = Boolean(file && !fileError && !isBusy);

  const resetFlow = () => {
    setFile(null);
    setStep("select");
    setStatus("idle");
    setFileError(null);
    setUploadError(null);
    setPreview(null);
    setActiveBatchId(null);
    setAppliedRowCount(null);
    setIsDragging(false);
    commit.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseAnotherFile = () => {
    resetFlow();
    inputRef.current?.click();
  };

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    setUploadError(null);
    setPreview(null);
    setAppliedRowCount(null);
    commit.reset();

    if (!selectedFile) {
      setFileError(null);
      setStatus("idle");
      return;
    }

    const validationError = getImportFileValidationError({
      fileName: selectedFile.name,
      mimeType: selectedFile.type,
      sizeBytes: selectedFile.size,
    });
    setFileError(validationError);
    setStatus(validationError ? "error" : "idle");
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    handleFileChange(event.dataTransfer.files[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file) return;
    const validationError = getImportFileValidationError({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (validationError) {
      setStatus("error");
      setFileError(validationError);
      return;
    }

    setStatus("uploading");
    setUploadError(null);
    setFileError(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/imports/upload", {
        method: "POST",
        body,
      });
      const text = await response.text();
      let data: Record<string, unknown> = {};
      if (text) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          data = {};
        }
      }

      if (!response.ok) {
        setStatus("error");
        setUploadError(
          typeof data.error === "string" ? data.error : "Upload failed.",
        );
        return;
      }

      if (typeof data.importBatchId !== "string") {
        setStatus("error");
        setUploadError("The file was parsed, but its import ID was missing.");
        return;
      }

      const warnings = Array.isArray(data.warnings)
        ? data.warnings.filter(
            (warning): warning is string => typeof warning === "string",
          )
        : [];
      const rows = Array.isArray(data.previewRows)
        ? data.previewRows.filter(isPreviewRow).slice(0, 3)
        : [];

      setPreview({
        importBatchId: data.importBatchId,
        originalFileName: file.name,
        sourceType:
          typeof data.sourceType === "string" ? data.sourceType : undefined,
        rowCount: typeof data.rowCount === "number" ? data.rowCount : 0,
        warnings,
        rows,
      });
      setFile(null);
      setStatus("idle");
      setStep("review");
      if (inputRef.current) inputRef.current.value = "";
      void list.refetch();
    } catch (error) {
      setStatus("error");
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    }
  };

  const handleApply = (importBatchId: string, nextPreview?: ImportPreview) => {
    if (nextPreview) setPreview(nextPreview);
    setActiveBatchId(importBatchId);
    setAppliedRowCount(null);
    commit.reset();
    setStep("apply");
    commit.mutate({ importBatchId });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Imports"
        title="Bring your portfolio up to date"
        description="Select an export, review the detected data, then apply it to your household portfolio."
        meta={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Source files are retained for 30 days. Import history remains
            available after files expire.
          </div>
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured ? (
        <>
          <input
            ref={inputRef}
            id="portfolio-file"
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            disabled={isBusy}
            onChange={(event) =>
              handleFileChange(event.target.files?.[0] ?? null)
            }
          />

          <ImportProgress currentStep={step} />

          {step === "select" ? (
            <SectionCard
              title="Select a portfolio export"
              description="Files are parsed first. Nothing changes in your portfolio until you review and apply the import."
              contentClassName="space-y-4"
            >
              <div
                className={cn(
                  "rounded-lg border border-dashed bg-muted/20 px-5 py-8 text-center transition-colors sm:px-8 sm:py-10",
                  isDragging && "border-primary bg-primary/5",
                  fileError && "border-negative/40 bg-negative/5",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!isBusy) setIsDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="mx-auto grid size-12 place-items-center rounded-lg border bg-card text-primary">
                  <UploadCloud className="size-5" aria-hidden="true" />
                </div>
                <p className="mt-4 font-semibold tracking-[-0.01em]">
                  Drop a CSV or XLSX file here
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                  Supported exports are detected automatically. Maximum file
                  size is 4 MB.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => inputRef.current?.click()}
                >
                  Browse files
                </Button>
              </div>

              {file ? (
                <div className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      <FileSpreadsheet className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {file.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
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

              {uploadError ? (
                <Alert className="border-negative/25 bg-negative/5">
                  <AlertTitle>We could not prepare this file</AlertTitle>
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex justify-end">
                <Button
                  disabled={!canUpload}
                  onClick={() => void handleUpload()}
                >
                  {status === "uploading" ? (
                    <LoaderCircle
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <UploadCloud aria-hidden="true" />
                  )}
                  {status === "uploading"
                    ? "Preparing review..."
                    : "Review file"}
                </Button>
              </div>
            </SectionCard>
          ) : null}

          {step === "review" && preview ? (
            <ReviewImport
              preview={preview}
              onChooseAnother={chooseAnotherFile}
              onApply={() => handleApply(preview.importBatchId)}
            />
          ) : null}

          {step === "apply" && preview ? (
            <SectionCard
              title={commit.isError ? "Import not applied" : "Applying import"}
              description={
                commit.isError
                  ? "Your existing portfolio data has not changed."
                  : "The reviewed rows are being added to your portfolio."
              }
            >
              {commit.isError ? (
                <ErrorState
                  title="We could not apply this import"
                  description={
                    commit.error instanceof Error
                      ? commit.error.message
                      : "The import request failed. Please try again."
                  }
                  onRetry={() => handleApply(preview.importBatchId)}
                />
              ) : (
                <div
                  role="status"
                  className="flex min-h-36 flex-col items-center justify-center rounded-xl bg-muted/25 p-6 text-center"
                >
                  <LoaderCircle
                    className="size-6 animate-spin text-primary motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <p className="mt-3 font-semibold">
                    Applying {preview.rowCount.toLocaleString("en-IN")} rows
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep this page open until the import is complete.
                  </p>
                </div>
              )}
            </SectionCard>
          ) : null}

          {step === "done" && preview ? (
            <SectionCard
              title="Import applied"
              description="Your portfolio is ready to review."
            >
              <div className="flex flex-col gap-5 rounded-xl bg-positive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 size-6 shrink-0 text-positive"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-semibold">
                      {sourceLabel(preview.sourceType)} data is now in your
                      portfolio
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {(appliedRowCount ?? preview.rowCount).toLocaleString(
                        "en-IN",
                      )}{" "}
                      normalized rows were applied from{" "}
                      {preview.originalFileName}.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" onClick={resetFlow}>
                    Import another
                  </Button>
                  <Button asChild>
                    <Link href="/dashboard">View dashboard</Link>
                  </Button>
                </div>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Supported exports"
            description="Use the original export without renaming sheets or editing column headings."
            className="mt-4"
          >
            <div className="grid gap-5 md:grid-cols-[1.1fr_0.9fr] md:gap-8">
              <SourceGuide source={sourceGuidance[0]} featured />
              <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-1">
                {sourceGuidance.slice(1).map((source) => (
                  <SourceGuide key={source.title} source={source} />
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Recent imports"
            description="Import records remain visible after the original source file reaches its 30-day retention date."
            className="mt-4"
          >
            {list.isLoading ? (
              <ImportHistorySkeleton />
            ) : list.isError ? (
              <ErrorState
                title="We could not load import history"
                description="Your existing imports are unchanged. Try loading the history again."
                onRetry={() => void list.refetch()}
              />
            ) : (list.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="No import history yet"
                description="Select a supported portfolio export to create your first import."
              />
            ) : (
              <div className="grid gap-3">
                {list.data?.map((batch) => {
                  const workflow = historyWorkflow(batch);
                  const retention = historyRetention(batch);
                  const canApply =
                    !batch.committedAt &&
                    batch.errors.length === 0 &&
                    batch.rowCount > 0 &&
                    (batch.status === "parsed" ||
                      (batch.status === "expired" && batch.processedAt));
                  const historyPreview: ImportPreview = {
                    importBatchId: batch.id,
                    originalFileName: batch.originalFileName,
                    sourceType: batch.sourceType,
                    rowCount: batch.rowCount,
                    warnings: batch.warnings,
                    rows: [],
                  };

                  return (
                    <article
                      key={batch.id}
                      className="rounded-xl border bg-background p-4"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {batch.originalFileName}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {sourceLabel(batch.sourceType)} / Uploaded{" "}
                            {formatDate(batch.uploadedAt)} /{" "}
                            {batch.rowCount.toLocaleString("en-IN")} normalized
                            rows
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Badge variant={workflow.variant}>
                            {workflow.label}
                          </Badge>
                          <Badge variant={retention.variant}>
                            {retention.label}
                          </Badge>
                          {batch.warnings.length > 0 ? (
                            <Badge variant="warning">
                              {batch.warnings.length} warning
                              {batch.warnings.length === 1 ? "" : "s"}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {batch.errors[0] ? (
                        <p
                          role="alert"
                          className="mt-3 text-xs leading-5 text-negative"
                        >
                          {batch.errors[0]}
                        </p>
                      ) : null}
                      {canApply ? (
                        <div className="mt-3 flex justify-end border-t pt-3">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={commit.isLoading}
                            onClick={() =>
                              handleApply(batch.id, historyPreview)
                            }
                          >
                            {commit.isLoading && activeBatchId === batch.id
                              ? "Applying..."
                              : "Apply import"}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </PageShell>
  );
}

function ImportProgress({ currentStep }: { currentStep: FlowStep }) {
  const currentIndex = flowSteps.findIndex(
    (flowStep) => flowStep.value === currentStep,
  );

  return (
    <nav
      aria-label="Import progress"
      className="mb-4 border-b border-border/70"
    >
      <ol className="-mb-px grid grid-cols-4">
        {flowSteps.map((flowStep, index) => {
          const complete = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={flowStep.value}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1.5 border-b-2 border-transparent px-1 py-3 text-[11px] font-semibold text-muted-foreground sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
                current && "border-primary text-foreground",
                complete && "text-primary",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-md border text-[11px]",
                  current &&
                    "border-primary bg-primary text-primary-foreground",
                  complete && "border-primary/20 bg-primary/10",
                )}
                aria-hidden="true"
              >
                {complete ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="truncate">{flowStep.label}</span>
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
  return (
    <SectionCard
      title="Review detected data"
      description="Check the source, row count, warnings, and sample rows before applying this import."
      contentClassName="space-y-5"
    >
      <div className="flex flex-col gap-3 rounded-xl border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-semibold">{preview.originalFileName}</p>
          <p className="mt-1 text-xs text-muted-foreground">Ready to apply</p>
        </div>
        <Badge variant="secondary">{sourceLabel(preview.sourceType)}</Badge>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted/30 p-4">
          <dt className="text-xs font-medium text-muted-foreground">
            Normalized rows
          </dt>
          <dd className="number mt-1 text-xl font-semibold">
            {preview.rowCount.toLocaleString("en-IN")}
          </dd>
        </div>
        <div className="rounded-xl bg-muted/30 p-4">
          <dt className="text-xs font-medium text-muted-foreground">
            Import batch ID
          </dt>
          <dd className="mt-1 break-all font-mono text-xs leading-5 text-foreground">
            {preview.importBatchId}
          </dd>
        </div>
      </dl>

      {preview.warnings.length > 0 ? (
        <Alert className="border-warning/25 bg-warning/5">
          <AlertTitle>
            {preview.warnings.length} import warning
            {preview.warnings.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {preview.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-positive/20 bg-positive/5">
          <AlertTitle>No import warnings</AlertTitle>
          <AlertDescription>
            The parser did not find issues that need your attention.
          </AlertDescription>
        </Alert>
      )}

      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Normalized row preview</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Showing up to three rows from the parsed file.
            </p>
          </div>
          <Badge variant="outline">
            {Math.min(preview.rows.length, preview.rowCount)} of{" "}
            {preview.rowCount.toLocaleString("en-IN")}
          </Badge>
        </div>
        {preview.rows.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {preview.rows.map((row, index) => {
              const summary = summarizePreviewRow(row);
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                >
                  <Badge variant="outline">{summary.kind}</Badge>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {summary.title}
                    </p>
                    {summary.detail ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {summary.detail}
                      </p>
                    ) : null}
                  </div>
                  {summary.value ? (
                    <p className="number text-sm font-semibold">
                      {summary.value}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            No normalized rows were returned for preview.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onChooseAnother}>
          Choose another file
        </Button>
        <Button disabled={preview.rowCount === 0} onClick={onApply}>
          Apply import
        </Button>
      </div>
    </SectionCard>
  );
}

function SourceGuide({
  source,
  featured = false,
}: {
  source: (typeof sourceGuidance)[number];
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        featured && "bg-secondary/45 sm:p-5",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{source.title}</h3>
        <Badge variant="outline">{source.format}</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {source.description}
      </p>
    </div>
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
        <div
          key={index}
          className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20 rounded-lg" />
            <Skeleton className="h-7 w-32 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function historyWorkflow(batch: {
  status: string;
  committedAt: Date | string | null;
  processedAt: Date | string | null;
  errors: string[];
}) {
  if (batch.committedAt || batch.status === "committed") {
    return { label: "Applied", variant: "positive" as const };
  }
  if (batch.status === "failed" || batch.errors.length > 0) {
    return { label: "Needs attention", variant: "negative" as const };
  }
  if (batch.status === "parsed" || batch.processedAt) {
    return { label: "Ready to apply", variant: "secondary" as const };
  }
  if (batch.status === "created" || batch.status === "uploaded") {
    return { label: "Preparing", variant: "secondary" as const };
  }
  return { label: "Not applied", variant: "outline" as const };
}

function historyRetention(batch: {
  status: string;
  sourceFileAvailable: boolean;
  expiresAt: Date | string;
}) {
  if (batch.status === "failed") {
    return { label: "Source file unavailable", variant: "negative" as const };
  }
  if (!batch.sourceFileAvailable) {
    return { label: "Source file expired", variant: "warning" as const };
  }
  return {
    label: `Retained until ${formatDate(batch.expiresAt)}`,
    variant: "outline" as const,
  };
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
        .join(" / "),
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
        .join(" / "),
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
