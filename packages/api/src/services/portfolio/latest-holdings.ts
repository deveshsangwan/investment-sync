import {
  accounts,
  assetClassEnum,
  currencyEnum,
  holdingSnapshots,
  instruments,
} from "@investment-sync/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  aggregateDetectionSql,
  aggregateSnapshotGroupMatchSql,
} from "./aggregates";
import { cachedPortfolioData } from "./cache";
import type { AssetClass, CurrentHoldingRow, PortfolioContext } from "./types";

const currentHoldingRowSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  instrumentId: z.string(),
  snapshotDate: z.string(),
  quantity: z.string().nullable(),
  investedAmount: z.string(),
  currentValue: z.string(),
  pnlAmount: z.string().nullable(),
  pnlPercent: z.string().nullable(),
  currency: z.enum(currencyEnum.enumValues),
  sourcePayload: z.record(z.unknown()),
  sourceSheet: z.string(),
  accountName: z.string(),
  provider: z.string(),
  instrumentName: z.string(),
  symbol: z.string().nullable(),
  assetClass: z.enum(assetClassEnum.enumValues),
});

type LatestHoldingMode = "current" | "exited";

export async function latestCurrentHoldings(
  ctx: PortfolioContext,
  assetClass?: AssetClass,
): Promise<CurrentHoldingRow[]> {
  const cacheKey = assetClass
    ? `portfolio.latestCurrentHoldings.${assetClass}`
    : "portfolio.latestCurrentHoldings";
  return cachedPortfolioData(ctx, cacheKey, () =>
    latestCurrentHoldingRows(ctx, "current", assetClass),
  );
}

export async function exitedCurrentHoldings(
  ctx: PortfolioContext,
  assetClass?: AssetClass,
): Promise<CurrentHoldingRow[]> {
  const cacheKey = assetClass
    ? `portfolio.exitedCurrentHoldings.${assetClass}`
    : "portfolio.exitedCurrentHoldings";
  return cachedPortfolioData(ctx, cacheKey, () =>
    latestCurrentHoldingRows(ctx, "exited", assetClass),
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
      accountId: holdingSnapshots.accountId,
      instrumentId: holdingSnapshots.instrumentId,
      snapshotDate: holdingSnapshots.snapshotDate,
      quantity: holdingSnapshots.quantity,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      pnlAmount: holdingSnapshots.pnlAmount,
      pnlPercent: holdingSnapshots.pnlPercent,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      sourceSheet: sql<string>`coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '')`,
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
  selected: Pick<
    CurrentHoldingRow,
    "accountId" | "instrumentId" | "currency" | "sourceSheet"
  >,
) {
  return ctx.db
    .select({
      id: holdingSnapshots.id,
      accountId: holdingSnapshots.accountId,
      instrumentId: holdingSnapshots.instrumentId,
      snapshotDate: holdingSnapshots.snapshotDate,
      quantity: holdingSnapshots.quantity,
      investedAmount: holdingSnapshots.investedAmount,
      currentValue: holdingSnapshots.currentValue,
      pnlAmount: holdingSnapshots.pnlAmount,
      pnlPercent: holdingSnapshots.pnlPercent,
      currency: holdingSnapshots.currency,
      sourcePayload: holdingSnapshots.sourcePayload,
      sourceSheet: sql<string>`coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '')`,
      accountName: accounts.name,
      provider: accounts.provider,
    })
    .from(holdingSnapshots)
    .innerJoin(accounts, eq(accounts.id, holdingSnapshots.accountId))
    .where(
      sql`${holdingSnapshots.householdId} = ${ctx.membership.householdId}
        and ${holdingSnapshots.accountId} = ${selected.accountId}
        and ${holdingSnapshots.instrumentId} = ${selected.instrumentId}
        and ${holdingSnapshots.currency} = ${selected.currency}
        and coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', '') = ${selected.sourceSheet}`,
    )
    .orderBy(holdingSnapshots.snapshotDate);
}

async function latestCurrentHoldingRows(
  ctx: PortfolioContext,
  mode: LatestHoldingMode,
  assetClass?: AssetClass,
): Promise<CurrentHoldingRow[]> {
  const aggregateExpression = aggregateDetectionSql(
    sql.raw("hs.source_payload"),
    sql.raw("i.name"),
    sql.raw("coalesce(hs.source_payload->>'sourceSheet', '')"),
  );
  const assetClassFilter = assetClass
    ? sql`and i.asset_class = ${assetClass}`
    : sql``;
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
        hs.account_id::text as "accountId",
        hs.instrument_id::text as "instrumentId",
        hs.snapshot_date::text as "snapshotDate",
        hs.quantity::text as "quantity",
        hs.invested_amount::text as "investedAmount",
        hs.current_value::text as "currentValue",
        hs.pnl_amount::text as "pnlAmount",
        hs.pnl_percent::text as "pnlPercent",
        hs.currency as "currency",
        hs.source_payload as "sourcePayload",
        coalesce(hs.source_payload->>'sourceSheet', '') as "sourceSheet",
        a.name as "accountName",
        a.provider as "provider",
        i.name as "instrumentName",
        i.symbol as "symbol",
        i.asset_class as "assetClass",
        (${aggregateExpression}) as "isAggregate",
        coalesce(upper(i.symbol), upper(i.name)) as "instrumentKey"
      from holding_snapshots hs
      inner join accounts a on a.id = hs.account_id
      inner join instruments i on i.id = hs.instrument_id
      where hs.household_id = ${ctx.membership.householdId}
        ${assetClassFilter}
    ),
    snapshot_groups_with_details as (
      select distinct "assetClass"
        , "accountId"
        , "accountName"
        , "provider"
        , "currency"
        , "sourceSheet"
        , "snapshotDate"
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
          from snapshot_groups_with_details details
          where ${aggregateSnapshotGroupMatchSql(sql.raw("details"), sql.raw("base"))}
        )
    ),
    latest_group_dates as (
      select
        "accountId",
        "accountName",
        "provider",
        "assetClass",
        "currency",
        "sourceSheet",
        max("snapshotDate") as "snapshotDate"
      from eligible
      group by
        "accountId",
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
        on latest."accountId" = eligible."accountId"
        and latest."accountName" = eligible."accountName"
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
        on latest."accountId" = eligible."accountId"
        and latest."accountName" = eligible."accountName"
        and latest."provider" = eligible."provider"
        and latest."assetClass" = eligible."assetClass"
        and latest."currency" = eligible."currency"
        and latest."sourceSheet" = eligible."sourceSheet"
    ),
    ranked as (
      select
        *,
        row_number() over (
          partition by
            "accountId",
            "accountName",
            "provider",
            "sourceSheet",
            "assetClass",
            "instrumentId",
            "instrumentKey",
            "currency"
          order by "snapshotDate" desc, "instrumentName" asc, "id" desc
        ) as "holdingRank"
      from ${sourceCte}
    )
    select
      "id",
      "accountId",
      "instrumentId",
      "snapshotDate",
      "quantity",
      "investedAmount",
      "currentValue",
      "pnlAmount",
      "pnlPercent",
      "currency",
      "sourcePayload",
      "sourceSheet",
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
