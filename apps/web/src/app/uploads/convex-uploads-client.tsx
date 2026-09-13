"use client";

import { useState } from "react";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@investment-sync/backend/api";
import { useImportWorkflow } from "@/features/imports/use-import-workflow";
import { PageHeader, PageShell, Panel } from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate, sourceLabel } from "@/lib/format";

export function ConvexUploadsClient() {
  const { isAuthenticated } = useConvexAuth();
  const current = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const history = usePaginatedQuery(
    api.imports.list,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 20 },
  );
  const workflow = useImportWorkflow();
  const [file, setFile] = useState<File | null>(null);
  const isOwner = current?.role === "owner";
  const isParsing =
    workflow.batch?.status === "parsing" ||
    workflow.batch?.status === "uploaded";

  return (
    <PageShell>
      <PageHeader
        title="Imports"
        description="Select a statement and review the detected data."
        meta={
          <p className="text-xs text-muted-foreground">
            Source files are kept for 30 days. Import history stays available
            after a file expires.
          </p>
        }
      />
      {!current ? (
        <p role="status">Loading import permissions…</p>
      ) : !isOwner ? (
        <p>Only household owners can import files.</p>
      ) : (
        <Panel title="Select a portfolio export" bodyClassName="space-y-4">
          <p className="text-sm text-muted-foreground">
            Supported CSV and XLSX exports are detected automatically. Files up
            to 256 KB.
          </p>
          <input
            aria-label="Portfolio file"
            type="file"
            accept=".csv,.xlsx"
            disabled={workflow.isUploading || isParsing}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            disabled={!file || workflow.isUploading || isParsing}
            onClick={() => {
              if (file) void workflow.upload(file);
            }}
          >
            {workflow.isUploading
              ? "Uploading…"
              : isParsing
                ? "Preparing preview…"
                : "Upload and preview"}
          </Button>
          {workflow.error || workflow.batch?.errorMessage ? (
            <Alert className="border-negative/50">
              <AlertDescription>
                {workflow.error ?? workflow.batch?.errorMessage}
              </AlertDescription>
            </Alert>
          ) : null}
          {workflow.batch?.status === "parsed" ? (
            <div className="space-y-3">
              <h2 className="text-sm font-medium">Review detected data</h2>
              <p>
                {sourceLabel(workflow.batch.sourceType)} ·{" "}
                {workflow.batch.rowCount} rows
              </p>
              {workflow.batch.warnings.map((warning, index) => (
                <p key={index} className="text-sm text-muted-foreground">
                  {warning}
                </p>
              ))}
              <ul className="divide-y divide-border">
                {workflow.previewRows.map((row, index) => (
                  <li key={index} className="py-2 text-sm">
                    {row.kind === "valuation"
                      ? `Portfolio valuation · ${row.valuationDate}`
                      : row.instrumentName}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                The preview is ready. Your portfolio has not changed.
              </p>
            </div>
          ) : null}
        </Panel>
      )}
      <Panel title="Import history" bodyClassName="space-y-4">
        {history.status === "LoadingFirstPage" ? (
          <p role="status">Loading import history…</p>
        ) : history.results.length === 0 ? (
          <p>No imports yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.results.map((batch) => (
              <li
                key={batch.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{batch.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(new Date(batch.createdAt))} · {batch.status} ·{" "}
                    {batch.rowCount} rows
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {batch.fileAvailable
                      ? "Source file available"
                      : "Source file unavailable · import history retained"}
                  </p>
                  {batch.errorMessage ? (
                    <p role="alert" className="text-sm text-negative">
                      {batch.errorMessage}
                    </p>
                  ) : null}
                </div>
                {isOwner && batch.status === "failed" && batch.fileAvailable ? (
                  <Button
                    variant="outline"
                    onClick={() => void workflow.retry(batch.id)}
                  >
                    Retry parsing
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {history.status === "CanLoadMore" ? (
          <Button variant="outline" onClick={() => history.loadMore(20)}>
            Load more
          </Button>
        ) : null}
      </Panel>
    </PageShell>
  );
}
