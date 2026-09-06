import { PageHeader, PageShell } from "@/components/portfolio-ui";
import { PortfolioContentSkeleton } from "@/components/portfolio-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export type LoadingPage =
  | "overview"
  | "holdings"
  | "holding"
  | "asset"
  | "imports"
  | "accounts"
  | "document";

export function PageLoading({ page }: { page: LoadingPage }) {
  const isPortfolio =
    page === "overview" ||
    page === "holdings" ||
    page === "holding" ||
    page === "asset";

  return (
    <PageShell>
      {page === "imports" ? (
        <PageHeader
          title="Imports"
          description="Select a statement, check what was detected, then apply it. Nothing changes in your portfolio until you apply."
          meta={
            <p className="text-xs text-muted-foreground">
              Source files are kept for 30 days. Import history stays available
              after a file expires.
            </p>
          }
        />
      ) : (
        <div
          className="mb-8 flex items-center justify-between gap-6"
          aria-hidden="true"
        >
          <Skeleton className="h-8 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="hidden h-11 w-32 sm:block" />
          </div>
        </div>
      )}
      {isPortfolio ? (
        <PortfolioContentSkeleton variant={page} />
      ) : (
        <div
          role="status"
          aria-label={`Loading ${page}`}
          aria-busy="true"
          className="space-y-8"
        >
          <span className="sr-only">Loading page</span>
          {page === "imports" ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {[0, 1, 2, 3].map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <Skeleton className="size-6 shrink-0" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border bg-card p-5">
                <h2 className="text-[0.82rem] font-semibold">
                  Select a portfolio export
                </h2>
                <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed px-5 py-10">
                  <Skeleton className="size-5" />
                  <Skeleton className="mt-3 h-4 w-52" />
                  <Skeleton className="mt-3 h-4 w-80" />
                  <Skeleton className="mt-4 h-11 w-28" />
                </div>
                <div className="mt-4 flex justify-end">
                  <Skeleton className="h-11 w-32" />
                </div>
              </div>
              <div>
                <h2 className="text-[0.82rem] font-semibold">
                  Supported exports
                </h2>
                <Skeleton className="mt-2 h-3 w-96" />
                <div className="mt-3 divide-y border-y">
                  {[0, 1, 2, 3].map((row) => (
                    <div
                      key={row}
                      className="grid gap-3 py-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto]"
                    >
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-[0.82rem] font-semibold">Recent imports</h2>
                <Skeleton className="mt-2 h-3 w-96" />
                <LoadingRows />
              </div>
            </>
          ) : page === "accounts" ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="space-y-5 rounded-2xl border bg-card p-6"
                  >
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-60" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-5 w-40" />
              <LoadingRows />
            </>
          ) : (
            <div className="max-w-3xl space-y-8">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 py-5">
          <Skeleton className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
