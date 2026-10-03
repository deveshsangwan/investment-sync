import { HoldingDetailClient } from "./holding-detail-client";

export default function Loading() {
  // Use the same authenticated query view even before the route payload arrives.
  return <HoldingDetailClient />;
}
