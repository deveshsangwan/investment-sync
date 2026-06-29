"use client";

import { useState } from "react";
import { getImportFileValidationError } from "@investment-sync/importers";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { SetupRequired } from "@/components/dashboard-states";
import {
  EmptyState,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/portfolio-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { trpc } from "../providers";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function UploadsClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [warningDetails, setWarningDetails] = useState<string[]>([]);
  const utils = trpc.useUtils();
  const list = trpc.imports.list.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const commit = trpc.imports.commit.useMutation({
    onSuccess: () => {
      void utils.imports.list.invalidate();
      void utils.portfolio.overview.invalidate();
      void utils.portfolio.summary.invalidate();
      void utils.portfolio.holdings.invalidate();
    },
  });

  const isBusy = status === "uploading" || commit.isLoading;
  const canUpload = Boolean(isDataConfigured && file && !fileError);
  const statusTone: Record<string, "positive" | "negative" | "secondary"> = {
    committed: "positive",
    parsed: "secondary",
    created: "secondary",
    uploaded: "secondary",
    failed: "negative",
    expired: "negative",
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
      setMessage(validationError);
      return;
    }
    setStatus("uploading");
    setMessage(null);
    setFileError(null);
    setWarningDetails([]);

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
      const warnings = Array.isArray(data.warnings)
        ? data.warnings.filter(
            (warning): warning is string => typeof warning === "string",
          )
        : [];
      const rowCount = typeof data.rowCount === "number" ? data.rowCount : 0;
      const sourceType =
        typeof data.sourceType === "string" ? data.sourceType : undefined;

      if (!response.ok) {
        setStatus("error");
        setMessage(
          typeof data.error === "string" ? data.error : "Upload failed.",
        );
        return;
      }

      const warningSuffix =
        warnings.length > 0
          ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""})`
          : "";
      setStatus("success");
      setWarningDetails(warnings);
      setMessage(
        `Parsed ${rowCount} rows${sourceType ? ` from ${sourceType}` : ""}${warningSuffix}.`,
      );
      setFile(null);
      setFileError(null);
      void list.refetch();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    }
  };

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    setWarningDetails([]);
    if (!selectedFile) {
      setFileError(null);
      if (status === "error") setMessage(null);
      return;
    }

    const validationError = getImportFileValidationError({
      fileName: selectedFile.name,
      mimeType: selectedFile.type,
      sizeBytes: selectedFile.size,
    });
    setFileError(validationError);
    if (validationError) {
      setStatus("error");
      setMessage(validationError);
    } else {
      setStatus("idle");
      setMessage(null);
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Uploads"
        title="Import portfolio files"
        description="Upload holdings, valuations, or transaction exports to refresh your dashboard."
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      {message ? (
        <Alert
          className={cn(
            "mb-4",
            status === "error" && "border-rose-500/30 bg-rose-500/10",
          )}
        >
          <AlertTitle>
            {status === "error" ? "Upload failed" : "Upload complete"}
          </AlertTitle>
          <AlertDescription>
            <div>{message}</div>
            {warningDetails.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {warningDetails.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <SectionCard title="New upload">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <input
              type="file"
              accept=".csv,.xlsx"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!isDataConfigured}
              onChange={(event) =>
                handleFileChange(event.target.files?.[0] ?? null)
              }
            />
            {file ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Selected: {file.name}
              </p>
            ) : null}
            {fileError ? (
              <p className="mt-2 text-xs font-medium text-rose-600">
                {fileError}
              </p>
            ) : null}
          </div>
          <Button
            onClick={() => {
              void handleUpload();
            }}
            disabled={!canUpload || isBusy}
          >
            <UploadCloud className="size-4" />
            {status === "uploading" ? "Uploading and parsing..." : "Upload"}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Recent imports" className="mt-4">
        {(list.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No uploads yet"
            description="Upload a portfolio file to see import history."
          />
        ) : (
          <div className="grid gap-3">
            {list.data?.map((batch) => (
              <div
                key={batch.id}
                className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {batch.originalFileName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Uploaded {formatDate(batch.uploadedAt)} · {batch.rowCount}{" "}
                    rows
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusTone[batch.status] ?? "outline"}>
                    {batch.status}
                  </Badge>
                  {batch.status === "parsed" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={commit.isLoading}
                      onClick={() => commit.mutate({ importBatchId: batch.id })}
                    >
                      {commit.isLoading ? "Committing..." : "Commit"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
