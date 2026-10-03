"use client";

import { useParams } from "next/navigation";
import { PageLoading } from "@/components/page-loading";
import { parseAssetClass } from "@/lib/asset-classes";
import { AssetClassClient } from "./asset-class-client";

export default function Loading() {
  const params = useParams();
  const assetClass =
    typeof params.assetClass === "string"
      ? parseAssetClass(params.assetClass)
      : undefined;

  // The route payload may still be loading while Convex already has live data.
  return assetClass ? (
    <AssetClassClient assetClass={assetClass} />
  ) : (
    <PageLoading page="asset" />
  );
}
