import Link from "next/link";
import { Panel } from "@/components/portfolio-ui";
import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton({ title }: { title: string }) {
  const labels =
    title === "Household"
      ? ["Name", "Sign-in email"]
      : [
          "Import portfolio files",
          "Manage household settings",
          "View portfolio data",
        ];

  return (
    <Panel title={title}>
      <div
        role="status"
        aria-label={`Loading ${title.toLowerCase()}`}
        className="divide-y"
      >
        {labels.map((label) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 py-3 text-sm"
          >
            <span className="min-w-0 text-muted-foreground">{label}</span>
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
      {title === "Household" && (
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Every account and holding in Investment Sync belongs to this
          household.
        </p>
      )}
    </Panel>
  );
}

export function AccountsSkeleton() {
  return (
    <div role="status" aria-label="Loading connected accounts">
      <div className="hidden grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b py-3 text-xs text-muted-foreground md:grid">
        {["Name", "Provider", "Type", "Currency"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="grid grid-cols-[1fr_auto] gap-4 border-b py-5 md:grid-cols-[2fr_1fr_1fr_1fr]"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="hidden h-3 w-12 md:block" />
        </div>
      ))}
    </div>
  );
}

export function AccountsPageSkeleton() {
  return (
    <>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProfileSkeleton title="Household" />
        <ProfileSkeleton title="What you can do" />
      </section>
      <section className="mt-8">
        <h2 className="text-[0.82rem] font-semibold">Portfolio accounts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accounts available to organize your imported holdings.
        </p>
        <div className="mt-3">
          <AccountsSkeleton />
        </div>
      </section>
      <AccountsFileInformation />
    </>
  );
}

export function AccountsFileInformation() {
  return (
    <section className="mt-8">
      <h2 className="text-[0.82rem] font-semibold">Files and data</h2>
      <dl className="mt-3 divide-y divide-border/70 border-y border-border/70 text-sm">
        <div className="grid gap-1 py-3.5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium">Original source files</dt>
          <dd className="text-muted-foreground">
            Kept for 30 days by default, then removed from private storage
            during scheduled cleanup.
          </dd>
        </div>
        <div className="grid gap-1 py-3.5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium">Normalized portfolio data</dt>
          <dd className="text-muted-foreground">
            Holdings, transactions, and valuations stay after the file expires,
            so the portfolio keeps working.
          </dd>
        </div>
        <div className="grid gap-1 py-3.5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
          <dt className="font-medium">Access</dt>
          <dd className="text-muted-foreground">
            Clerk handles authentication. Portfolio requests are restricted to
            your signed-in household.{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy details
            </Link>
          </dd>
        </div>
      </dl>
    </section>
  );
}
