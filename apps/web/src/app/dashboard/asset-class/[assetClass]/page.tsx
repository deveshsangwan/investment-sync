import { isDataConfigured } from "@investment-sync/api";
import { notFound } from "next/navigation";
import { parseAssetClass } from "@/lib/asset-classes";
import { AssetClassClient } from "./asset-class-client";

export default async function AssetClassPage({
  params,
}: {
  params: Promise<{ assetClass: string }>;
}) {
  const { assetClass } = await params;
  const decodedAssetClass = decodeURIComponent(assetClass);
  const parsedAssetClass = parseAssetClass(decodedAssetClass);
  if (!parsedAssetClass) {
    notFound();
  }

  return (
    <AssetClassClient
      assetClass={parsedAssetClass}
      isDataConfigured={isDataConfigured()}
    />
  );
}
