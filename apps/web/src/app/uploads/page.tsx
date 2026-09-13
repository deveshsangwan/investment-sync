import { isDataConfigured } from "@investment-sync/api";
import { ConvexUploadsClient } from "./convex-uploads-client";
import { UploadsClient } from "./uploads-client";

export default function UploadsPage() {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_CONVEX_IMPORTS_ENABLED === "true"
  ) {
    if (!process.env.NEXT_PUBLIC_CONVEX_URL)
      return (
        <div role="alert" className="p-8">
          The import service is not configured for this environment.
        </div>
      );

    return <ConvexUploadsClient />;
  }

  return <UploadsClient isDataConfigured={isDataConfigured()} />;
}
