"use client";

import { useState } from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { SetupRequired } from "@/components/dashboard-states";
import { EmptyState, PageHeader, PageShell, SectionCard } from "@/components/portfolio-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { trpc } from "../providers";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function UploadsClient({ isDataConfigured }: { isDataConfigured: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const list = trpc.imports.list.useQuery(undefined, { enabled: isDataConfigured });
  const commit = trpc.imports.commit.useMutation({
    onSuccess: () => {
      void list.refetch();
    },
  });

  const isBusy = status === "uploading" || commit.isLoading;
  const canUpload = Boolean(isDataConfigured && file);
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
    setStatus("uploading");
    setMessage(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/imports/upload", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as {
        rowCount?: number;
        warnings?: string[];
        error?: string;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Upload failed.");
        return;
      }

      const warningSuffix =
        data.warnings && data.warnings.length > 0
          ? ` (${data.warnings.length} warning${data.warnings.length > 1 ? "s" : ""})`
          : "";
      setStatus("success");
      setMessage(`Parsed ${data.rowCount ?? 0} rows${warningSuffix}.`);
      setFile(null);
      void list.refetch();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
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
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <SectionCard title="New upload">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <input
              type="file"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!isDataConfigured}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            onClick={() => {
              void handleUpload();
            }}
            disabled={!canUpload || isBusy}
          >
            <UploadCloud className="size-4" />
            {status === "uploading" ? "Uploading..." : "Upload"}
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
                  <div className="text-sm font-semibold">{batch.originalFileName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Uploaded {formatDate(batch.uploadedAt)} · {batch.rowCount} rows
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
                      Commit
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
