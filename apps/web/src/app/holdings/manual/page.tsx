import type { Metadata } from "next";
import { ManualEntryClient } from "./manual-entry-client";

export const metadata: Metadata = {
  title: "Manual entry",
  description: "Add and update ULIP values from your insurer.",
};

export default async function ManualEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ policy?: string | string[] }>;
}) {
  const { policy } = await searchParams;

  return (
    <ManualEntryClient
      initialPolicyId={typeof policy === "string" ? policy : undefined}
    />
  );
}
