import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PortfolioContentSkeleton({
  variant = "overview",
}: {
  variant?: "overview" | "holdings" | "holding" | "asset";
}) {
  const isHoldings = variant === "holdings";
  const isOverview = variant === "overview";

  return (
    <div
      role="status"
      aria-label="Loading portfolio data"
      aria-busy="true"
      className="space-y-8"
    >
      <span className="sr-only">Loading portfolio data</span>
      {isHoldings ? (
        <>
          <div className="grid grid-cols-3 gap-4 border-b pb-6">
            {[0, 1, 2].map((item) => (
              <div key={item} className="min-w-0">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-3 h-6 w-32" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_145px] gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <HoldingRows />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-8 border-b pb-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <Skeleton className="h-12 w-80" />
              <Skeleton className="mt-3 h-4 w-64" />
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:flex sm:flex-wrap sm:gap-6">
              {Array.from(
                { length: variant === "asset" ? 5 : 4 },
                (_, index) => (
                  <div key={index} className="min-w-0">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-3 h-5 w-24" />
                  </div>
                ),
              )}
            </div>
          </div>
          <div
            className={cn(
              "grid gap-4",
              isOverview
                ? "lg:grid-cols-[minmax(0,1fr)_300px]"
                : "lg:grid-cols-[1.4fr_1fr]",
            )}
          >
            <div className="min-w-0 rounded-2xl border bg-card p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-3 w-60" />
              <div
                className="mt-6 flex h-64 flex-col justify-between border-b border-l px-4 pb-5 pt-2"
                aria-hidden="true"
              >
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-px bg-border/50" />
                ))}
                <Skeleton className="h-1 w-full" />
              </div>
              <div className="mt-3 flex justify-between">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border bg-card p-5">
              <Skeleton className="mb-7 h-4 w-28" />
              {[72, 55, 42, 30].map((width) => (
                <div key={width} className="mt-6">
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton
                    className="mt-3 h-1"
                    style={{ width: `${width}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
          {isOverview && (
            <div>
              <Skeleton className="mb-4 h-4 w-32" />
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="min-w-0 overflow-hidden rounded-2xl border bg-card"
                  >
                    <div className="flex items-center gap-3 border-b px-5 py-4">
                      <Skeleton className="size-5" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="p-5">
                      <Skeleton className="h-8 w-44" />
                      {[0, 1, 2].map((row) => (
                        <div
                          key={row}
                          className="mt-4 flex justify-between gap-5"
                        >
                          <Skeleton className="h-3 w-24" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <HoldingRows />
        </>
      )}
    </div>
  );
}

function HoldingRows() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-32" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3 border-b py-5">
          <Skeleton className="size-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
          <Skeleton className="hidden h-3 w-24 sm:block" />
          <div className="ml-4 w-20 shrink-0">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-3 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}
