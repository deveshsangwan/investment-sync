"use client";

import { Database, ShieldCheck, Users } from "lucide-react";
import { MetricCard, PageHeader, PageShell, SectionCard } from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "../providers";

export function SettingsClient() {
  const me = trpc.auth.me.useQuery();
  const accounts = trpc.accounts.list.useQuery();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Accounts and access"
        description="Family sharing is modeled in the database and can be enabled after v1."
      />

      <section className="grid gap-4 md:grid-cols-2">
        <MetricCard
          icon={Users}
          label="Household"
          value={me.data?.user?.householdName ?? "My Portfolio"}
          detail={me.data?.user?.email ?? undefined}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Original uploads"
          value="30 days"
          detail="Daily cleanup removes retained source files"
        />
      </section>

      <SectionCard title="Accounts" className="mt-4">
        {(accounts.data?.length ?? 0) === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/35 p-4 text-sm text-muted-foreground">
            <Database className="size-5 text-primary" />
            Accounts will appear after imports are committed.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Currency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.data?.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-semibold">{account.name}</TableCell>
                  <TableCell>{account.provider}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{account.accountType}</Badge>
                  </TableCell>
                  <TableCell>{account.currency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageShell>
  );
}
