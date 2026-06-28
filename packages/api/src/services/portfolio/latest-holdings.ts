import {
  accounts,
  assetClassEnum,
  currencyEnum,
  holdingSnapshots,
  instruments,
} from "@investment-sync/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cachedPortfolioData } from "./cache";
import {
  AGGREGATE_HOLDING_NAME_SQL_PATTERN,
  AGGREGATE_HOLDING_SOURCE_VALUE,
} from "./utils";
import type { CurrentHoldingRow, PortfolioContext } from "./types";

const currentHoldingRowSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  snapshotDate: z.string(),
  quantity: z.string().nullable(),
  investedAmount: z.string(),
  currentValue: z.string(),
  pnlAmount: z.string().nullable(),
  pnlPercent: z.string().nullable(),
  currency: z.enum(currencyEnum.enumValues),
  sourcePayload: z.record(z.unknown()),
  accountName: z.string(),
  provider: z.string(),
  instrumentName: z.string(),
  symbol: z.string().nullable(),
  assetClass: z.enum(assetClassEnum.enumValues),
});

type LatestHoldingMode = "current" | "exited";

export async function latestCurrentHoldings(
  ctx: PortfolioContext,
): Promise<CurrentHoldingRow[]> {
  return cachedPortfolioData(ctx, "portfolio.latestCurrentHoldings", () =>
    latestCurrentHoldingRows(ctx, "current"),
  );
}

export async function exitedCurrentHoldings(
  ctx: PortfolioContext,
): Promise<CurrentHoldingRow[]> {
  return cachedPortfolioData(ctx, "portfolio.exitedCurrentHoldings", () =>
    latestCurrentHoldingRows(ctx, "exited"),
  );
}

export async function holdingById(
  ctx: PortfolioContext,
  id: string,
): Promise<
  (CurrentHoldingRow & { isin: string | null; exchange: string | null }) | null
> {
  const [selected] = await ctx.db
    .select({
      id: holdingSnapshots.id,
      instrumentId: holdingSnapshots.instrumentId,
      snapshotDate: holdingSnapshots.snapshotDate,
      quantity: holdingSnapshots.quantity,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      pnlAmount: holdingSnapshots.pnlAmount,
      pnlPercent: holdingSnapshots.pnlPercent,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      accountName: accounts.name,
      provider: accounts.provider,
      instrumentName: instruments.name,
      symbol: instruments.symbol,
      assetClass: instruments.assetClass,
      isin: instruments.isin,
      exchange: instruments.exchange,
    })
    .from(holdingSnapshots)
    .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
    .innerJoin(instruments, eq(instruments.id, holdingSnapshots.instrumentId))
    .where(
      sql`${holdingSnapshots.id} = ${id} and ${holdingSnapshots.householdId} = ${ctx.membership.householdId}`,
    )
    .limit(1);

  return selected ?? null;
}

export async function holdingHistory(
  ctx: PortfolioContext,
  instrumentId: string,
) {
  return ctx.db
    .select({
      id: holdingSnapshots.id,
      snapshotDate: holdingSnapshots.snapshotDate,
      quantity: holdingSnapshots.quantity,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      pnlAmount: holdingSnapshots.pnlAmount,
      pnlPercent: holdingSnapshots.pnlPercent,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      accountName: accounts.name,
      provider: accounts.provider,
    })
    .from(holdingSnapshots)
    .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
    .where(
      sql`${holdingSnapshots.householdId} = ${ctx.membership.householdId} and ${holdingSnapshots.instrumentId} = ${instrumentId}`,
    )
    .orderBy(holdingSnapshots.snapshotDate);
}

async function latestCurrentHoldingRows(
  ctx: PortfolioContext,
  mode: LatestHoldingMode,
): Promise<CurrentHoldingRow[]> {
  const aggregateExpression = sql`
    lower(coalesce(hs.source_payload->>'isAggregate', '')) = ${AGGREGATE_HOLDING_SOURCE_VALUE}
    or lower(rtrim(i.name)) like ${AGGREGATE_HOLDING_NAME_SQL_PATTERN}
  `;
  const sourceCte =
    mode === "current"
      ? sql`latest_group_rows`
      : sql`eligible_with_latest_group`;
  const modeWhere =
    mode === "current"
      ? sql`"holdingRank" = 1`
      : sql`"holdingRank" = 1 and "snapshotDate" <> "latestGroupSnapshotDate"`;

  const rows = await ctx.db.execute(sql`
    with base as (
      select
        hs.id::text as "id",
        hs.instrument_id::text as "instrumentId",
        hs.snapshot_date::text as "snapshotDate",
        hs.quantity::text as "quantity",
        hs.invested_amount::text as "investedAmount",
        hs.current_value::text as "currentValue",
        hs.pnl_amount::text as "pnlAmount",
        hs.pnl_percent::text as "pnlPercent",
        hs.currency as "currency",
        hs.source_payload as "sourcePayload",
        a.name as "accountName",
        a.provider as "provider",
        i.name as "instrumentName",
        i.symbol as "symbol",
        i.asset_class as "assetClass",
        coalesce(hs.source_payload->>'sourceSheet', '') as "sourceSheet",
        (${aggregateExpression}) as "isAggregate",
        coalesce(upper(i.symbol), upper(i.name)) as "instrumentKey"
      from holding_snapshots hs
      inner join accounts a on a.id = hs.account_id
      inner join instruments i on i.id = hs.instrument_id
      where hs.household_id = ${ctx.membership.householdId}
    ),
    asset_classes_with_details as (
      select distinct "assetClass"
      from base
      where "isAggregate" = false
    ),
    eligible as (
      select *
      from base
      where
        "isAggregate" = false
        or not exists (
          select 1
          from asset_classes_with_details details
          where details."assetClass" = base."assetClass"
        )
    ),
    latest_group_dates as (
      select
        "accountName",
        "provider",
        "assetClass",
        "currency",
        "sourceSheet",
        max("snapshotDate") as "snapshotDate"
      from eligible
      group by
        "accountName",
        "provider",
        "assetClass",
        "currency",
        "sourceSheet"
    ),
    latest_group_rows as (
      select eligible.*
      from eligible
      inner join latest_group_dates latest
        on latest."accountName" = eligible."accountName"
        and latest."provider" = eligible."provider"
        and latest."assetClass" = eligible."assetClass"
        and latest."currency" = eligible."currency"
        and latest."sourceSheet" = eligible."sourceSheet"
        and latest."snapshotDate" = eligible."snapshotDate"
    ),
    eligible_with_latest_group as (
      select eligible.*, latest."snapshotDate" as "latestGroupSnapshotDate"
      from eligible
      inner join latest_group_dates latest
        on latest."accountName" = eligible."accountName"
        and latest."provider" = eligible."provider"
        and latest."assetClass" = eligible."assetClass"
        and latest."currency" = eligible."currency"
        and latest."sourceSheet" = eligible."sourceSheet"
    ),
    ranked as (
      select
        *,
        row_number() over (
          partition by "assetClass", "instrumentKey", "currency"
          order by "snapshotDate" desc, "instrumentName" asc
        ) as "holdingRank"
      from ${sourceCte}
    )
    select
      "id",
      "instrumentId",
      "snapshotDate",
      "quantity",
      "investedAmount",
      "currentValue",
      "pnlAmount",
      "pnlPercent",
      "currency",
      "sourcePayload",
      "accountName",
      "provider",
      "instrumentName",
      "symbol",
      "assetClass"
    from ranked
    where ${modeWhere}
    order by "snapshotDate" desc, "instrumentName" asc
  `);

  return Array.from(rows, (row) => currentHoldingRowSchema.parse(row));
}
