import { PageShell } from "@/components/portfolio-ui";
import { PortfolioContentSkeleton } from "@/components/portfolio-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export type LoadingPage =
  | "overview"
  | "holdings"
  | "holding"
  | "asset"
  | "imports"
  | "accounts"
  | "home"
  | "auth"
  | "document";

export function PageLoading({ page }: { page: LoadingPage }) {
  const isPortfolio =
    page === "overview" ||
    page === "holdings" ||
    page === "holding" ||
    page === "asset";

  return (
    <PageShell>
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
      {isPortfolio ? (
        <PortfolioContentSkeleton variant={page} />
      ) : (
        <div
          role="status"
          aria-label={`Loading ${page === "auth" ? "sign in" : page}`}
          aria-busy="true"
          className="space-y-8"
        >
          <span className="sr-only">Loading page</span>
          {page === "imports" ? (
            <>
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border p-6">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-6 h-11 w-full" />
                  <div className="mt-5 grid h-48 place-items-center rounded-xl border border-dashed">
                    <Skeleton className="size-12" />
                  </div>
                  <Skeleton className="mt-5 h-11 w-32" />
                </div>
                <div className="space-y-6 p-6">
                  <Skeleton className="h-5 w-44" />
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex gap-4">
                      <Skeleton className="size-9 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="mt-3 h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Skeleton className="h-5 w-40" />
              <LoadingRows />
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
          ) : page === "auth" ? (
            <div className="grid gap-10 rounded-2xl border p-6 sm:p-10 lg:grid-cols-2">
              <div className="space-y-6">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="hidden h-64 w-full lg:block" />
              </div>
              <div className="space-y-6 rounded-xl bg-card p-5">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
          ) : page === "home" ? (
            <>
              <div className="grid items-center gap-12 py-12 lg:grid-cols-2">
                <div className="space-y-5">
                  <Skeleton className="h-12 w-80" />
                  <Skeleton className="h-12 w-64" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-11 w-44" />
                </div>
                <Skeleton className="h-64 w-full" />
              </div>
              <Skeleton className="h-64 w-full" />
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
