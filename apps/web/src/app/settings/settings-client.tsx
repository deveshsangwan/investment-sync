"use client";

import { api } from "@investment-sync/backend/api";
import type { FunctionReturnType } from "convex/server";
import { useCachedQuery } from "@/app/query-cache-provider";
import { Check, Database, FileUp, Lock } from "lucide-react";
import Link from "next/link";
import {
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
} from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ProfileSkeleton,
  AccountsSkeleton,
  AccountsFileInformation,
} from "@/components/accounts-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { labelize } from "@/lib/format";
import { ConvexSessionGate } from "../convex-provider";
import { ConvexQueryBoundary } from "@/components/convex-query-boundary";

export function SettingsClient() {
  return (
    <PageShell>
      <PageHeader
        title="Accounts"
        description="Your household, portfolio accounts, and what happens to your files."
        action={
          <Button asChild>
            <Link href="/uploads">
              <FileUp className="size-4" aria-hidden="true" />
              Import statement
            </Link>
          </Button>
        }
      />

      <ConvexSessionGate loading={<SettingsSkeleton />}>
        <ConvexQueryBoundary
          title="Accounts could not be loaded"
          description="Account and permission details are temporarily unavailable. Your portfolio data has not changed."
        >
          <SettingsData />
        </ConvexQueryBoundary>
      </ConvexSessionGate>
    </PageShell>
  );
}

function SettingsData() {
  const current = useCachedQuery(api.users.current);
  const accounts = useCachedQuery(api.accounts.list);
  const isOwner = current?.role === "owner";

  return (
    <>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!current ? (
          <>
            <ProfileSkeleton title="Household" />
            <ProfileSkeleton title="What you can do" />
          </>
        ) : (
          <>
            <Panel title="Household">
              <dl className="divide-y divide-border/70 text-sm">
                <Detail label="Name" value={current.householdName} />
                <Detail
                  label="Sign-in email"
                  value={current.email ?? "Not recorded"}
                />
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Every account and holding in Investment Sync belongs to this
                household.
              </p>
            </Panel>

            <Panel title="What you can do">
              <ul className="divide-y divide-border/70 text-sm">
                <Permission
                  label="Import portfolio files"
                  isGranted={isOwner}
                />
                <Permission
                  label="Manage household settings"
                  isGranted={isOwner}
                />
                <Permission label="View portfolio data" isGranted />
              </ul>
            </Panel>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[0.82rem] font-semibold">Portfolio accounts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accounts available to organize your imported holdings.
        </p>

        <div className="mt-3">
          {!accounts ? (
            <AccountsSkeleton />
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No portfolio accounts yet"
              description="Accounts appear here after you review and apply a supported portfolio import."
              action={
                <Button asChild size="sm">
                  <Link href="/uploads">Import statement</Link>
                </Button>
              }
            />
          ) : (
            <AccountInventory accounts={accounts} />
          )}
        </div>
      </section>

      <AccountsFileInformation />
    </>
  );
}

function SettingsSkeleton() {
  return (
    <>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProfileSkeleton title="Household" />
        <ProfileSkeleton title="What you can do" />
      </section>
      <section className="mt-8">
        <AccountsSkeleton />
      </section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}

function Permission({
  label,
  isGranted,
}: {
  label: string;
  isGranted: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2.5">
        {isGranted ? (
          <Check className="size-4 shrink-0 text-positive" aria-hidden="true" />
        ) : (
          <Lock
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0">{label}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {isGranted ? "Allowed" : "Not allowed"}
      </span>
    </li>
  );
}

type Account = FunctionReturnType<typeof api.accounts.list>[number];

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
                <TableCell className="font-medium">{account.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {labelize(account.provider)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {labelize(account.accountType)}
                </TableCell>
                <TableCell className="number text-right">
                  {account.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y divide-border/70 border-y border-border/70 md:hidden">
        {accounts.map((account) => (
          <li key={account.id} className="py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {labelize(account.provider)} · {labelize(account.accountType)}
                </p>
              </div>
              <Badge variant="outline">{account.currency}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
