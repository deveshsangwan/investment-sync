import { HoldingDetailClient } from "./holding-detail-client";

export default async function HoldingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isDataConfigured = Boolean(
    process.env.DATABASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return <HoldingDetailClient id={id} isDataConfigured={isDataConfigured} />;
}
