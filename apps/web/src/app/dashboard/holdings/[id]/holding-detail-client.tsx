"use client";

import Link from "next/link";
import {
  ArrowLeft,
  FileSpreadsheet,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PageShell,
  SectionCard,
  TrendRow,
} from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "../../../providers";

const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const usdCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function HoldingDetailClient({
  id,
  isDataConfigured,
}: {
  id: string;
  isDataConfigured: boolean;
}) {
  const detail = trpc.portfolio.holdingDetail.useQuery(
    { id },
    { enabled: isDataConfigured },
  );
  const data = detail.data;
  const holding = data?.holding;
  const pnlTone = (holding?.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  const historyValues = data?.history.map((point) => point.currentValueInInr) ?? [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Holding"
        title={holding ? (holding.symbol ?? holding.instrumentName) : "Holding"}
        description={
          holding
            ? `${labelize(holding.assetClass)} · ${holding.accountName} · ${holding.provider}`
            : "Loading holding analytics"
        }
        before={
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-3">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </Button>
        }
        action={
          holding ? (
            <Button variant="secondary" asChild>
              <Link
                href={`/dashboard/asset-class/${encodeURIComponent(holding.assetClass)}`}
              >
                {labelize(holding.assetClass)}
              </Link>
            </Button>
          ) : null
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}
      {isDataConfigured && !detail.isLoading && !holding ? <MissingHolding /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Current value"
          value={formatCurrency(
            Number(holding?.currentValue ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <MetricCard
          label="Invested"
          value={formatCurrency(
            Number(holding?.investedAmount ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <MetricCard
          icon={TrendingUp}
          label="Gain/Loss"
          value={formatCurrency(
            Number(holding?.pnlAmount ?? 0),
            holding?.currency ?? "INR",
          )}
          tone={pnlTone}
        />
        <MetricCard
          label="Return"
          value={formatPercent(numberOrUndefined(holding?.pnlPercent))}
          tone={pnlTone}
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="XIRR"
          value={formatPercent(holding?.xirr)}
          detail={qualityLabel(holding?.xirrDataQuality)}
        />
        <MetricCard
          label="Portfolio weight"
          value={
            holding?.isCurrent === false
              ? "Exited"
              : formatPercent(holding?.portfolioWeight)
          }
          detail={
            holding?.isCurrent === false ? "Absent from latest snapshot" : undefined
          }
        />
        <MetricCard
          label="P&L contribution"
          value={formatPercent(holding?.pnlContribution)}
          tone={pnlTone}
        />
        <MetricCard label="Snapshots" value={`${data?.history.length ?? 0}`} />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Value history">
          {(data?.history.length ?? 0) < 2 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No history yet"
              description="More dated uploads will build this holding history."
            />
          ) : (
            <div className="divide-y">
              {data?.history.slice(-10).map((point) => (
                <TrendRow
                  key={point.id}
                  label={formatDate(point.snapshotDate)}
                  sublabel={`${point.accountName} · ${point.provider} · invested ${formatCurrency(
                    Number(point.investedAmount),
                    point.currency,
                  )}`}
                  value={formatCurrency(Number(point.currentValue), point.currency)}
                  width={trendWidth(point.currentValueInInr, historyValues)}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Holding facts">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Quantity", holding?.quantity ?? "N/A"],
              ["Last updated", holding ? formatDate(holding.snapshotDate) : "N/A"],
              ["Currency", holding?.currency ?? "N/A"],
              ["ISIN", holding?.isin ?? "N/A"],
              ["Exchange", holding?.exchange ?? "N/A"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-muted/30 p-3">
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </section>

      <SectionCard title="Transactions" className="mt-4">
        {(data?.transactions.length ?? 0) === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Transaction imports will unlock exact XIRR and realized gains."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{formatDate(transaction.tradeDate)}</TableCell>
                  <TableCell>{labelize(transaction.type)}</TableCell>
                  <TableCell>{transaction.quantity ?? "N/A"}</TableCell>
                  <TableCell>
                    {transaction.price
                      ? formatCurrency(Number(transaction.price), transaction.currency)
                      : "N/A"}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatCurrency(Number(transaction.amount), transaction.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageShell>
  );
}

function SetupRequired() {
  return (
    <Alert className="mb-4 border-amber-500/30 bg-amber-500/10">
      <AlertTitle>Connect Supabase before loading portfolio data</AlertTitle>
      <AlertDescription>
        Add the database and Supabase environment variables, then restart.
      </AlertDescription>
    </Alert>
  );
}

function MissingHolding() {
  return (
    <div className="mb-4">
      <EmptyState
        icon={FileSpreadsheet}
        title="This holding was not found"
        description="It may have been replaced by a newer import or removed."
        action={
          <Button variant="secondary" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}

function formatCurrency(value: number, currency: string) {
  if (currency === "USD") return usdCurrency.format(value);
  return inrCurrency.format(value);
}

function formatPercent(value: number | undefined | null) {
  return value === undefined || value === null ? "N/A" : `${value}%`;
}

function qualityLabel(value: string | undefined) {
  if (value === "exact") return "Exact cash-flow XIRR";
  if (value === "source_provided") return "Imported";
  if (value === "estimated") return "Estimated from snapshots";
  return "Needs cash flows";
}

function numberOrUndefined(value: string | number | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function trendWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1);
  return Math.max(6, Math.round((value / max) * 100));
}
