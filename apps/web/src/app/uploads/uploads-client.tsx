"use client";

import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { FormEvent, useState } from "react";
import { EmptyState, PageHeader, PageShell, SectionCard } from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "../providers";

interface UploadResult {
  importBatchId: string;
  sourceType: string;
  parserVersion: string;
  rowCount: number;
  warnings: string[];
}

export function UploadsClient() {
  const utils = trpc.useUtils();
  const imports = trpc.imports.list.useQuery();
  const commit = trpc.imports.commit.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.imports.list.invalidate(),
        utils.portfolio.summary.invalidate(),
        utils.portfolio.holdings.invalidate(),
      ]);
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.set("file", file);

    const response = await fetch("/api/imports/upload", {
      method: "POST",
      body: form,
    });

    const payload = (await response.json()) as UploadResult | { error: string };
    setIsUploading(false);

    if (!response.ok) {
      setError("error" in payload ? payload.error : "Upload failed");
      return;
    }

    setResult(payload as UploadResult);
    await utils.imports.list.invalidate();
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Uploads"
        title="Import investment files"
        description="Supported now: Tickertape stock CSV, Tickertape mutual fund CSV, Vested XLSX, and your current workbook."
      />

      <SectionCard title="Upload source file">
        <form
          className="grid min-h-64 place-items-center rounded-lg border border-dashed bg-muted/30 p-6 text-center"
          onSubmit={onSubmit}
        >
          <div className="max-w-xl">
            <div className="mx-auto grid size-14 place-items-center rounded-lg bg-primary/10 text-primary">
              <UploadCloud className="size-7" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">Choose a CSV or XLSX file</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The file is parsed into a preview first. You can commit the import
              after the row count and warnings look right.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge variant="secondary">.csv</Badge>
              <Badge variant="secondary">.xlsx</Badge>
              <Badge variant="outline">Tickertape</Badge>
              <Badge variant="outline">Vested</Badge>
            </div>
            <input
              className="mt-5 w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-semibold"
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Selected: {file.name}
              </p>
            ) : null}
            <Button className="mt-5" disabled={!file || isUploading} type="submit">
              {isUploading ? "Parsing..." : "Upload and preview"}
            </Button>
            {error ? <p className="negative mt-3 text-sm font-semibold">{error}</p> : null}
          </div>
        </form>
      </SectionCard>

      {result ? (
        <SectionCard title="Import preview" className="mt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Detected <span className="font-semibold">{result.sourceType}</span>{" "}
                with <span className="font-semibold">{result.rowCount}</span> rows
                using {result.parserVersion}.
              </p>
              {result.warnings.length > 0 ? (
                <p className="negative mt-2 text-sm font-semibold">
                  {result.warnings.join(", ")}
                </p>
              ) : null}
            </div>
            <Button
              disabled={commit.isPending}
              onClick={() => commit.mutate({ importBatchId: result.importBatchId })}
            >
              {commit.isPending ? "Committing..." : "Commit import"}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Import history" className="mt-4">
        {(imports.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No imports yet"
            description="Completed and staged imports will be listed here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Original expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.data?.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-semibold">
                    {batch.originalFileName}
                  </TableCell>
                  <TableCell>{batch.sourceType}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{batch.status}</Badge>
                  </TableCell>
                  <TableCell>{batch.rowCount}</TableCell>
                  <TableCell>
                    {new Date(batch.expiresAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageShell>
  );
}
