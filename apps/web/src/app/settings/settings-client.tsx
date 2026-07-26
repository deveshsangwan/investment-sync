"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import {
  CheckCircle2,
  Database,
  FileClock,
  LockKeyhole,
  ShieldCheck,
  UploadCloud,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  SectionCard,
} from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { labelize } from "@/lib/format";
import { trpc } from "../providers";

export function SettingsClient() {
  const me = trpc.auth.me.useQuery();
  const accounts = trpc.accounts.list.useQuery();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Household and data"
        description="Review your portfolio identity, connected accounts, access permissions, and source-file retention."
        action={
          <Button asChild>
            <Link href="/uploads">
              <UploadCloud className="size-4" aria-hidden="true" />
              Import data
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        {me.isLoading ? (
          <>
            <ProfileSkeleton title="Household" />
            <ProfileSkeleton title="Access permissions" />
          </>
        ) : me.error ? (
          <div className="lg:col-span-2">
            <ErrorState
              title="We couldn't load your household profile"
              description="Account and permission details are temporarily unavailable. Your portfolio data has not changed."
              onRetry={() => void me.refetch()}
            />
          </div>
        ) : me.data?.user ? (
          <>
            <SectionCard
              title="Household"
              description="The portfolio identity attached to your signed-in account."
            >
              <dl className="grid gap-5 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Household name
                  </dt>
                  <dd className="mt-2 break-words text-lg font-semibold tracking-[-0.025em]">
                    {me.data.user.householdName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Sign-in email
                  </dt>
                  <dd className="mt-2 break-words text-sm font-semibold">
                    {me.data.user.email}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-secondary/55 p-4">
                <Users
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  All accounts and holdings shown in Investment Sync belong to
                  this household.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              title="Access permissions"
              description="Capabilities granted to your current household membership."
            >
              <div className="grid gap-3">
                <PermissionRow
                  label="Import portfolio files"
                  granted={me.data.permissions.canUpload}
                />
                <PermissionRow
                  label="Manage household settings"
                  granted={me.data.permissions.canManageHousehold}
                />
                <PermissionRow label="View portfolio data" granted />
              </div>
            </SectionCard>
          </>
        ) : (
          <div className="lg:col-span-2">
            <ErrorState
              title="Household profile unavailable"
              description="We couldn't find the household profile attached to this session. Try loading it again."
              onRetry={() => void me.refetch()}
            />
          </div>
        )}
      </section>

      <SectionCard
        title="Connected accounts"
        description="Active account records created from applied portfolio imports."
        className="mt-4"
      >
        {accounts.isLoading ? (
          <AccountsSkeleton />
        ) : accounts.error ? (
          <ErrorState
            title="We couldn't load connected accounts"
            description="The account inventory is temporarily unavailable. Your saved accounts have not changed."
            onRetry={() => void accounts.refetch()}
          />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No connected accounts yet"
            description="Accounts appear here after you review and apply a supported portfolio import."
            action={
              <Button asChild size="sm">
                <Link href="/uploads">Import data</Link>
              </Button>
            }
          />
        ) : (
          <AccountInventory accounts={accounts.data} />
        )}
      </SectionCard>

      <SectionCard
        title="Data and privacy"
        description="What Investment Sync keeps after you upload a portfolio file."
        className="mt-4"
      >
        <div className="grid overflow-hidden rounded-lg border border-border/70 md:grid-cols-2 md:divide-x md:divide-border/70">
          <div className="border-b border-border/70 p-5 md:border-b-0">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-accent text-primary">
                <FileClock className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Original source files
                </p>
                <p className="mt-1 font-semibold">30 days by default</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Expired upload objects are removed from private storage. Import
              status can remain visible in your history.
            </p>
          </div>

          <div className="p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-accent text-primary">
                <Database className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Normalized portfolio data
                </p>
                <p className="mt-1 font-semibold">Remains after file expiry</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Parsed holdings, transactions, and valuations remain available so
              the portfolio continues to work.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-xl bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Authentication is handled by Clerk. Portfolio requests are
              restricted to your signed-in household.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/privacy">Privacy details</Link>
          </Button>
        </div>
      </SectionCard>
    </PageShell>
  );
}

function ProfileSkeleton({ title }: { title: string }) {
  return (
    <SectionCard title={title}>
      <div role="status" aria-label={`Loading ${title.toLowerCase()}`}>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-7 w-52" />
        <Skeleton className="mt-6 h-20 w-full" />
      </div>
    </SectionCard>
  );
}

function PermissionRow({
  label,
  granted,
}: {
  label: string;
  granted: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/45 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        {granted ? (
          <CheckCircle2
            className="size-4 shrink-0 text-positive"
            aria-hidden="true"
          />
        ) : (
          <LockKeyhole
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <Badge variant={granted ? "positive" : "secondary"}>
        {granted ? "Granted" : "Not granted"}
      </Badge>
    </div>
  );
}

function AccountsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading connected accounts"
      className="space-y-3"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

type Account = inferRouterOutputs<AppRouter>["accounts"]["list"][number];

function AccountInventory({ accounts }: { accounts: Account[] }) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Currency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell className="font-semibold">{account.name}</TableCell>
                <TableCell>{labelize(account.provider)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {labelize(account.accountType)}
                  </Badge>
                </TableCell>
                <TableCell className="number text-right font-semibold">
                  {account.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden">
        {accounts.map((account) => (
          <article
            key={account.id}
            className="rounded-xl border bg-background/45 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{account.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {labelize(account.provider)}
                </p>
              </div>
              <Badge variant="secondary">{account.currency}</Badge>
            </div>
            <p className="mt-4 text-xs font-medium text-muted-foreground">
              {labelize(account.accountType)}
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
