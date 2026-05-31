import { AssetClassClient } from "./asset-class-client";

export default async function AssetClassPage({
  params,
}: {
  params: Promise<{ assetClass: string }>;
}) {
  const { assetClass } = await params;
  const isDataConfigured = Boolean(
    process.env.DATABASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return (
    <AssetClassClient
      assetClass={decodeURIComponent(assetClass)}
      isDataConfigured={isDataConfigured}
    />
  );
}
