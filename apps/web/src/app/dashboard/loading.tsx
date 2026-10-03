"use client";

import { usePathname } from "next/navigation";
import { PageLoading } from "@/components/page-loading";
import AssetClassLoading from "./asset-class/[assetClass]/loading";
import HoldingLoading from "./holdings/[id]/loading";

export default function Loading() {
  const pathname = usePathname();

  // This boundary also covers detail routes before their own fallback arrives.
  if (pathname.startsWith("/dashboard/holdings/")) return <HoldingLoading />;
  if (pathname.startsWith("/dashboard/asset-class/"))
    return <AssetClassLoading />;

  return <PageLoading page="overview" />;
}
