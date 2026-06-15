import { isDataConfigured } from "@investment-sync/api";
import { HoldingDetailClient } from "./holding-detail-client";

export default async function HoldingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <HoldingDetailClient id={id} isDataConfigured={isDataConfigured()} />;
}
