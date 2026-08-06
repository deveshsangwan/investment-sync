"use client";

import type { AppRouter } from "@investment-sync/api";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowDownRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Search,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SetupRequired } from "@/components/dashboard-states";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PortfolioContentSkeleton,
} from "@/components/portfolio-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAsOfDate,
  formatInr,
  formatPercent,
  labelize,
  numberOrUndefined,
} from "@/lib/format";
import { trpc } from "../providers";

type Position = inferRouterOutputs<AppRouter>["portfolio"]["positions"][
  | "current"
  | "exited"][number] & { isExited: boolean };

type PositionStatus = "current" | "exited" | "all";
type SortKey = "value" | "pnl" | "return" | "name";

const controlClass =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-hidden transition-colors hover:border-primary/40 focus:border-primary";

export function HoldingsClient({
  isDataConfigured,
}: {
  isDataConfigured: boolean;
}) {
  const query = trpc.portfolio.positions.useQuery(undefined, {
    enabled: isDataConfigured,
  });
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [account, setAccount] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [status, setStatus] = useState<PositionStatus>("current");
  const [sort, setSort] = useState<SortKey>("value");

  const allPositions: Position[] = [
    ...(query.data?.current.map((item) => ({
      ...item,
      isExited: false,
    })) ?? []),
    ...(query.data?.exited.map((item) => ({
      ...item,
      isExited: true,
    })) ?? []),
  ];
  const filters = {
    assetClasses: unique(allPositions.map((item) => item.assetClass)),
    accounts: unique(allPositions.map((item) => item.accountName)),
    currencies: unique(allPositions.map((item) => item.currency)),
  };
  const normalizedSearch = search.trim().toLowerCase();
  const visiblePositions = allPositions
    .filter((item) => {
      if (status === "current" && item.isExited) return false;
      if (status === "exited" && !item.isExited) return false;
      if (assetClass !== "all" && item.assetClass !== assetClass) return false;
      if (account !== "all" && item.accountName !== account) return false;
      if (currency !== "all" && item.currency !== currency) return false;
      if (!normalizedSearch) return true;
      return [
        item.symbol,
        item.instrumentName,
        item.accountName,
        item.provider,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    })
    .sort((left, right) => comparePositions(left, right, sort));

  const resetFilters = () => {
    setSearch("");
    setAssetClass("all");
    setAccount("all");
    setCurrency("all");
    setStatus("current");
    setSort("value");
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Portfolio positions"
        title="Holdings"
        description="Search every account, compare exposure, and revisit positions that have left the latest snapshot."
        action={
          <Button asChild>
            <Link href="/uploads">
              <UploadCloud className="size-4" aria-hidden="true" />
              Import data
            </Link>
          </Button>
        }
      />

      {!isDataConfigured ? <SetupRequired /> : null}

      {isDataConfigured && query.isLoading ? (
        <PortfolioContentSkeleton metricCount={4} />
      ) : null}

      {isDataConfigured && query.isError ? (
        <ErrorState
          title="Holdings couldn't be loaded"
          description="The saved portfolio is unchanged. Try loading the positions again."
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.isSuccess ? (
        <>
          <section className="mb-4 grid overflow-hidden rounded-xl border border-border/80 bg-card sm:grid-cols-3 sm:divide-x">
            <Summary
              label="Current positions"
              value={query.data.current.length}
            />
            <Summary
              label="Exited positions"
              value={query.data.exited.length}
            />
            <Summary
              label="Current value"
              value={formatInr(
                query.data.current.reduce(
                  (total, item) => total + item.currentValueInInr,
                  0,
                ),
              )}
              monetary
            />
          </section>

          <Card className="mb-4 shadow-none">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal
                  className="size-4 text-primary"
                  aria-hidden="true"
                />
                Find a position
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(130px,0.7fr))]">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Search
                  </span>
                  <span className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <input
                      className={`${controlClass} w-full pl-9`}
                      type="search"
                      placeholder="Name, symbol, or provider"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </span>
                </label>
                <FilterSelect
                  label="Position status"
                  value={status}
                  onChange={(value) => setStatus(value as PositionStatus)}
                  options={[
                    ["current", "Current"],
                    ["exited", "Exited"],
                    ["all", "All positions"],
                  ]}
                />
                <FilterSelect
                  label="Asset class"
                  value={assetClass}
                  onChange={setAssetClass}
                  options={[
                    ["all", "All asset classes"],
                    ...filters.assetClasses.map((value) => [
                      value,
                      labelize(value),
                    ]),
                  ]}
                />
                <FilterSelect
                  label="Account"
                  value={account}
                  onChange={setAccount}
                  options={[
                    ["all", "All accounts"],
                    ...filters.accounts.map((value) => [value, value]),
                  ]}
                />
                <FilterSelect
                  label="Currency"
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    ["all", "All currencies"],
                    ...filters.currencies.map((value) => [value, value]),
                  ]}
                />
                <FilterSelect
                  label="Sort holdings"
                  value={sort}
                  onChange={(value) => setSort(value as SortKey)}
                  options={[
                    ["value", "Largest value"],
                    ["pnl", "Largest gain"],
                    ["return", "Best return"],
                    ["name", "Name A-Z"],
                  ]}
                />
              </div>
            </CardContent>
          </Card>

          {visiblePositions.length === 0 ? (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No positions match these filters"
              description="Clear the filters to return to the complete household view."
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Holding</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>P&amp;L</TableHead>
                      <TableHead>Return</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePositions.map((position) => (
                      <PositionTableRow
                        key={`${position.id}-${position.isExited}`}
                        position={position}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {visiblePositions.map((position) => (
                  <PositionCard
                    key={`${position.id}-${position.isExited}`}
                    position={position}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}
    </PageShell>
  );
}

function Summary({
  label,
  value,
  monetary = false,
}: {
  label: string;
  value: string | number;
  monetary?: boolean;
}) {
  return (
    <div className="border-b border-border/65 px-4 py-3.5 last:border-b-0 sm:border-b-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${monetary ? "number" : ""} mt-1 text-lg font-semibold`}>
        {value}
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        className={`${controlClass} w-full`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function PositionTableRow({ position }: { position: Position }) {
  const tone =
    Number(position.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Link
            className="font-semibold tracking-[-0.01em] hover:text-primary"
            href={`/dashboard/holdings/${position.id}`}
          >
            {position.symbol ?? position.instrumentName}
          </Link>
          {position.isExited ? <Badge variant="secondary">Exited</Badge> : null}
        </div>
        {position.symbol ? (
          <p className="mt-1 max-w-72 truncate text-xs text-muted-foreground">
            {position.instrumentName}
          </p>
        ) : null}
      </TableCell>
      <TableCell>
        <p>{position.accountName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {labelize(position.assetClass)}
        </p>
      </TableCell>
      <TableCell className="number font-medium">
        {formatInr(position.currentValueInInr)}
      </TableCell>
      <TableCell className={`number font-medium ${tone}`}>
        <span className="inline-flex items-center gap-1">
          {tone === "positive" ? (
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="size-3.5" aria-hidden="true" />
          )}
          {formatInr(position.pnlAmountInInr ?? 0)}
        </span>
      </TableCell>
      <TableCell className={`number font-medium ${tone}`}>
        {formatPercent(numberOrUndefined(position.pnlPercent))}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatAsOfDate(position.snapshotDate)}
      </TableCell>
    </TableRow>
  );
}

function PositionCard({ position }: { position: Position }) {
  const tone =
    Number(position.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  return (
    <Link
      href={`/dashboard/holdings/${position.id}`}
      className="block p-4 transition-colors hover:bg-muted/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">
              {position.symbol ?? position.instrumentName}
            </p>
            {position.isExited ? (
              <Badge variant="secondary">Exited</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {position.accountName} / {labelize(position.assetClass)}
          </p>
        </div>
        <p className="number shrink-0 font-semibold">
          {formatInr(position.currentValueInInr)}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {formatAsOfDate(position.snapshotDate)}
        </span>
        <span
          className={`number inline-flex items-center gap-1 font-medium ${tone}`}
        >
          {tone === "positive" ? (
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="size-3.5" aria-hidden="true" />
          )}
          {formatPercent(numberOrUndefined(position.pnlPercent))}
        </span>
      </div>
    </Link>
  );
}

function comparePositions(left: Position, right: Position, sort: SortKey) {
  if (sort === "name") {
    return (left.symbol ?? left.instrumentName).localeCompare(
      right.symbol ?? right.instrumentName,
    );
  }
  if (sort === "pnl") {
    return Number(right.pnlAmountInInr ?? 0) - Number(left.pnlAmountInInr ?? 0);
  }
  if (sort === "return") {
    return (
      Number(right.pnlPercent ?? -Infinity) -
      Number(left.pnlPercent ?? -Infinity)
    );
  }
  return right.currentValueInInr - left.currentValueInInr;
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
