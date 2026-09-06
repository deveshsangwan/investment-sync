"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, Database, FileUp, Lock } from "lucide-react";
import Link from "next/link";
import {
  EmptyState,
  ErrorState,
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
import { trpc } from "../providers";

export function SettingsClient() {
  const me = trpc.auth.me.useQuery();
  const accounts = trpc.accounts.list.useQuery();

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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {me.isLoading ? (
          <>
            <ProfileSkeleton title="Household" />
            <ProfileSkeleton title="What you can do" />
          </>
        ) : me.error ? (
          <div className="lg:col-span-2">
            <ErrorState
              title="Your household profile could not be loaded"
              description="Account and permission details are temporarily unavailable. Your portfolio data has not changed."
              onRetry={() => void me.refetch()}
            />
          </div>
        ) : me.data?.user ? (
          <>
            <Panel title="Household">
              <dl className="divide-y divide-border/70 text-sm">
                <Detail label="Name" value={me.data.user.householdName} />
                <Detail
                  label="Sign-in email"
                  value={me.data.user.email ?? "Not recorded"}
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
                  isGranted={me.data.permissions.canUpload}
                />
                <Permission
                  label="Manage household settings"
                  isGranted={me.data.permissions.canManageHousehold}
                />
                <Permission label="View portfolio data" isGranted />
              </ul>
            </Panel>
          </>
        ) : (
          <div className="lg:col-span-2">
            <ErrorState
              title="Household profile unavailable"
              description="No household profile is attached to this session. Try loading it again."
              onRetry={() => void me.refetch()}
            />
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[0.82rem] font-semibold">Portfolio accounts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accounts available to organize your imported holdings.
        </p>

        <div className="mt-3">
          {accounts.isLoading ? (
            <AccountsSkeleton />
          ) : accounts.error ? (
            <ErrorState
              title="Portfolio accounts could not be loaded"
              description="The account inventory is temporarily unavailable. Your saved accounts have not changed."
              onRetry={() => void accounts.refetch()}
            />
          ) : accounts.data.length === 0 ? (
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
            <AccountInventory accounts={accounts.data} />
          )}
        </div>
      </section>

      <AccountsFileInformation />
    </PageShell>
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
