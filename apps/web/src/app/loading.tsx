import { PageShell } from "@/components/portfolio-ui";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell>
      <div
        role="status"
        aria-label="Loading page"
        aria-busy="true"
        className="space-y-8"
      >
        <span className="sr-only">Loading page</span>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    </PageShell>
  );
}
