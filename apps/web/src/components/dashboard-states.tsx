"use client";

import Link from "next/link";
import { ArrowRight, FileSpreadsheet, UploadCloud } from "lucide-react";
import { EmptyState } from "@/components/portfolio-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function SetupRequired() {
  return (
    <Alert className="mb-4 border-amber-500/30 bg-amber-500/10">
      <AlertTitle>Portfolio data is not connected</AlertTitle>
      <AlertDescription>
        Ask a workspace administrator to finish the data connection, then try
        again.
      </AlertDescription>
    </Alert>
  );
}

export function EmptyPortfolio() {
  return (
    <div className="mb-4">
      <EmptyState
        icon={UploadCloud}
        title="Import your first portfolio file"
        description="Upload a Tickertape holdings CSV, mutual fund CSV, Vested P&L workbook, or your current investment workbook."
        action={
          <Button variant="secondary" asChild>
            <Link href="/uploads">
              Go to uploads
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />
    </div>
  );
}

export function MissingHolding() {
  return (
    <div className="mb-4">
      <EmptyState
        icon={FileSpreadsheet}
        title="This holding was not found"
        description="It may have been replaced by a newer import or removed."
        action={
          <Button variant="secondary" asChild>
            <Link href="/holdings">Back to holdings</Link>
          </Button>
        }
      />
    </div>
  );
}
