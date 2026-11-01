import {
  accounts,
  assetClassEnum,
  currencyEnum,
  holdingSnapshots,
  sourceSnapshots,
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
  isin: z.string().nullable(),
  exchange: z.string().nullable(),
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
  asOfDate?: string,
): Promise<CurrentHoldingRow[]> {
  const aggregateExpression = aggregateDetectionSql(
    sql.raw("hs.source_payload"),
    sql.raw("i.name"),
    sql.raw("coalesce(hs.source_payload->>'sourceSheet', '')"),
  );
  const assetClassFilter = assetClass
    ? sql`and i.asset_class = ${assetClass}`
    : sql``;

  // These importer-defined sources describe the same US Stocks portfolio.
  // Preserve the physical account and sheet on each row for history, while
  // reconciling complete snapshots across the two representations.
  const isVestedSource = sql`a.name = 'US Stocks'
    and a.provider = 'Vested / DriveWealth'
    and hs.source_type = 'vested_drivewealth_xlsx'
    and i.asset_class = 'us_stock' and hs.currency = 'USD'
    and coalesce(hs.source_payload->>'sourceSheet', '') = ''`;
  const isWorkbookSource = sql`a.name = 'US Stocks'
    and a.provider = 'Manual Workbook'
    and hs.source_type = 'investment_portfolio_xlsx'
    and i.asset_class = 'us_stock' and hs.currency = 'USD'
    and hs.source_payload->>'sourceSheet' = 'US stocks'`;

  const isIndianStockOverlap = sql`a.name = 'Indian Stocks'
    and i.asset_class = 'indian_stock' and hs.currency = 'INR'
    and ((a.provider = 'Manual Workbook' and hs.source_type = 'investment_portfolio_xlsx'
      and hs.source_payload->>'sourceSheet' = 'Stock Investments')
      or (a.provider = 'Tickertape' and hs.source_type = 'tickertape_stock_csv'
        and coalesce(hs.source_payload->>'sourceSheet', '') = ''))`;
  const isMutualFundOverlap = sql`a.name = 'Mutual Funds'
    and i.asset_class = 'mutual_fund' and hs.currency = 'INR'
    and ((a.provider = 'Manual Workbook' and hs.source_type = 'investment_portfolio_xlsx'
      and hs.source_payload->>'sourceSheet' = 'Mutual Funds')
      or (a.provider = 'Tickertape' and hs.source_type = 'tickertape_mutual_fund_csv'
        and coalesce(hs.source_payload->>'sourceSheet', '') = ''))`;

  const declarationAssetClassFilter = assetClass
    ? sql`and ss.asset_class = ${assetClass}`
    : sql``;
  const declarationVested = sql`a.name = 'US Stocks' and a.provider = 'Vested / DriveWealth'
    and ss.source_type = 'vested_drivewealth_xlsx' and ss.asset_class = 'us_stock'
    and ss.currency = 'USD' and ss.source_group = ''`;
  const declarationWorkbook = sql`a.name = 'US Stocks' and a.provider = 'Manual Workbook'
    and ss.source_type = 'investment_portfolio_xlsx' and ss.asset_class = 'us_stock'
    and ss.currency = 'USD' and ss.source_group = 'US stocks'`;
  const currentAtBoundary = sql`eligible."snapshotDate" = latest."snapshotDate"
    and eligible."sourcePriority" = latest."sourcePriority"
    and (latest."declarationBatch" is null
      or eligible."batchId" = latest."declarationBatch"
      or eligible."sourceSequence" > latest."sourceSequence")`;

  const sourceCte =
    mode === "current"
      ? sql`latest_group_rows`
      : sql`eligible_with_latest_group`;
  const modeWhere =
    mode === "current"
      ? sql`"holdingRank" = 1`
      : sql`"holdingRank" = 1 and (
          not "isCurrentAtBoundary"
        )`;

  const rows = await ctx.db.execute(sql`
    with base as (
      select
        case
          when (${isVestedSource}) or (${isWorkbookSource})
            then jsonb_build_array('workbook-vested-us-stocks')
          when (${isIndianStockOverlap})
            then jsonb_build_array('workbook-tickertape', 'indian_stock')
          when (${isMutualFundOverlap})
            then jsonb_build_array('workbook-tickertape', 'mutual_fund')
          else jsonb_build_array(hs.account_id)
        end as "selectionAccount",
        case when (${isVestedSource}) or (${isWorkbookSource})
          then jsonb_build_array('workbook-vested-us-stocks')
          else jsonb_build_array(hs.account_id, a.name, a.provider,
            i.asset_class, hs.currency, coalesce(hs.source_payload->>'sourceSheet', ''))
        end as "sourceGroup",
        case when (${isVestedSource}) then 1 else 0 end as "sourcePriority",
        hs.import_batch_id::text as "batchId",
        coalesce(ib.source_sequence, floor(extract(epoch from hs.created_at) * 1000)::bigint) as "sourceSequence",
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
        i.isin as "isin",
        i.exchange as "exchange",
        i.asset_class as "assetClass",
        (${aggregateExpression}) as "isAggregate",
        coalesce(nullif(upper(trim(i.symbol)), ''), upper(trim(i.name))) as "instrumentKey"
      from holding_snapshots hs
      left join import_batches ib on ib.id = hs.import_batch_id
      inner join accounts a on a.id = hs.account_id
      inner join instruments i on i.id = hs.instrument_id
      where hs.household_id = ${ctx.membership.householdId}
        ${assetClassFilter}
        ${asOfDate ? sql`and hs.snapshot_date <= ${asOfDate}` : sql``}
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
    declaration_boundaries as (
      select
        case when (${declarationVested}) or (${declarationWorkbook})
          then jsonb_build_array('workbook-vested-us-stocks')
          else jsonb_build_array(ss.account_id, a.name, a.provider,
            ss.asset_class, ss.currency, ss.source_group)
        end as "sourceGroup",
        ss.snapshot_date::text as "snapshotDate",
        case when (${declarationVested}) then 1 else 0 end as "sourcePriority",
        ss.import_batch_id::text as "declarationBatch",
        ss.source_sequence as "sourceSequence",
        ss.row_number as "rowNumber"
      from source_snapshots ss
      inner join accounts a on a.id = ss.account_id
      where ss.household_id = ${ctx.membership.householdId} ${declarationAssetClassFilter}
        ${asOfDate ? sql`and ss.snapshot_date <= ${asOfDate}` : sql``}
    ),
    boundaries as (
      select "sourceGroup", "snapshotDate", "sourcePriority",
        null::text as "declarationBatch", "sourceSequence", 0 as "rowNumber"
      from eligible
      union all
      select * from declaration_boundaries
    ),
    latest_group_dates as (
      select distinct on ("sourceGroup") *
      from boundaries
      order by "sourceGroup", "snapshotDate" desc, "sourcePriority" desc,
        ("declarationBatch" is not null) desc, "sourceSequence" desc,
        "declarationBatch" desc, "rowNumber" desc
    ),
    latest_group_rows as (
      select eligible.*
      from eligible
      inner join latest_group_dates latest
        on latest."sourceGroup" = eligible."sourceGroup"
        and ${currentAtBoundary}
    ),
    eligible_with_latest_group as (
      select eligible.*, (${currentAtBoundary}) as "isCurrentAtBoundary"
      from eligible
      inner join latest_group_dates latest
        on latest."sourceGroup" = eligible."sourceGroup"
    ),
    ranked as (
      select
        *,
        row_number() over (
          partition by
            "selectionAccount",
            "assetClass",
            "instrumentKey",
            "currency"
          order by "snapshotDate" desc, "sourcePriority" desc, "instrumentName" asc, "id" desc
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
      "isin",
      "exchange",
      "assetClass"
    from ranked
    where ${modeWhere}
    order by "snapshotDate" desc, "instrumentName" asc, "id" desc
  `);

  return Array.from(rows, (row) => currentHoldingRowSchema.parse(row));
}

export async function latestSourceSnapshotDate(ctx: PortfolioContext) {
  const [row] = await ctx.db
    .select({ date: sql<string | null>`max(${sourceSnapshots.snapshotDate})` })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.householdId, ctx.membership.householdId));

  return row?.date ?? null;
}

// Historical charts keep their reported-date semantics. An explicit same-day
// replacement must still remove rows omitted from the replacement report.
export function retainedAtDeclaredSnapshotSql() {
  return sql`not exists (
    select 1 from source_snapshots ss
    inner join accounts sa on sa.id = ss.account_id
    where ss.household_id = ${holdingSnapshots.householdId}
      and ss.snapshot_date = ${holdingSnapshots.snapshotDate}
      and ss.asset_class = ${instruments.assetClass} and ss.currency = ${holdingSnapshots.currency}
      and (
        (ss.account_id = ${holdingSnapshots.accountId}
          and ss.source_group = coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', ''))
        or (sa.name = 'US Stocks' and sa.provider = 'Vested / DriveWealth'
          and ss.source_type = 'vested_drivewealth_xlsx' and ss.asset_class = 'us_stock'
          and ss.currency = 'USD' and ss.source_group = ''
          and ${accounts.name} = 'US Stocks' and ${accounts.provider} = 'Manual Workbook'
          and ${holdingSnapshots.sourceType} = 'investment_portfolio_xlsx'
          and ${holdingSnapshots.sourcePayload}->>'sourceSheet' = 'US stocks')
      )
      and ss.import_batch_id is distinct from ${holdingSnapshots.importBatchId}
      and (ss.source_sequence > coalesce(
        (select ib.source_sequence from import_batches ib where ib.id = ${holdingSnapshots.importBatchId}),
        floor(extract(epoch from ${holdingSnapshots.createdAt}) * 1000)::bigint)
        or (sa.provider = 'Vested / DriveWealth' and ${accounts.provider} = 'Manual Workbook'))
  )`;
}

export function holdingsAtSourceSnapshot(
  ctx: PortfolioContext,
  snapshotDate: string,
  assetClass?: AssetClass,
) {
  return latestCurrentHoldingRows(ctx, "current", assetClass, snapshotDate);
}
