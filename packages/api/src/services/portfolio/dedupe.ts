import {
  accounts,
  holdingSnapshots,
  instruments,
  transactions,
} from "@investment-sync/db";
import { sql } from "drizzle-orm";
import type { ApiContext } from "../../context";
import { clearHouseholdPortfolioCache } from "../portfolio-cache";
import type { MembershipContext } from "../membership";
import { aggregateDetectionSql } from "./aggregates";

export async function dedupePortfolioData(
  ctx: ApiContext,
  membership: MembershipContext,
) {
  const result = await ctx.db.transaction(async (tx) => {
    const deletedAggregateHoldingSnapshots = await tx.execute(sql`
    with base as (
      select
        hs.id,
        hs.household_id,
        hs.account_id,
        hs.snapshot_date,
        hs.currency,
        coalesce(hs.source_payload->>'sourceSheet', '') as source_sheet,
        a.name as account_name,
        a.provider as provider,
        i.asset_class as asset_class,
        (${aggregateDetectionSql(
          sql`hs.source_payload`,
          sql`i.name`,
          sql`coalesce(hs.source_payload->>'sourceSheet', '')`,
        )}) as is_aggregate
      from holding_snapshots hs
      inner join accounts a on a.id = hs.account_id
      inner join instruments i on i.id = hs.instrument_id
      where hs.household_id = ${membership.householdId}
    ),
    snapshot_groups_with_details as (
      select distinct
        asset_class,
        account_id,
        account_name,
        provider,
        currency,
        source_sheet,
        snapshot_date
      from base
      where is_aggregate = false
    )
    delete from ${holdingSnapshots} hs
    using base
    where hs.id = base.id
      and base.is_aggregate = true
      and exists (
        select 1
        from snapshot_groups_with_details details
        where details.asset_class = base.asset_class
          and details.account_id = base.account_id
          and lower(trim(details.account_name)) = lower(trim(base.account_name))
          and lower(trim(details.provider)) = lower(trim(base.provider))
          and details.currency = base.currency
          and details.source_sheet = base.source_sheet
          and details.snapshot_date = base.snapshot_date
      )
    returning hs.id
  `);

    const deletedHoldingSnapshots = await tx.execute(sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by
            household_id,
            account_id,
            instrument_id,
            snapshot_date,
            currency
          order by created_at desc, id desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      where household_id = ${membership.householdId}
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

    const deletedSemanticHoldingSnapshots = await tx.execute(sql`
    with ranked as (
      select
        ${holdingSnapshots.id} as id,
        row_number() over (
          partition by
            ${holdingSnapshots.householdId},
            lower(${accounts.name}),
            lower(${accounts.provider}),
            ${holdingSnapshots.snapshotDate},
            ${holdingSnapshots.currency},
            coalesce(${holdingSnapshots.sourcePayload}->>'sourceSheet', ''),
            coalesce(upper(${instruments.symbol}), lower(${instruments.name}))
          order by ${holdingSnapshots.createdAt} desc, ${holdingSnapshots.id} desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      inner join ${accounts} on ${holdingSnapshots.accountId} = ${accounts.id}
      inner join ${instruments} on ${holdingSnapshots.instrumentId} = ${instruments.id}
      where ${holdingSnapshots.householdId} = ${membership.householdId}
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

    const deletedCrossSourceStockSnapshots = await tx.execute(sql`
    with ranked as (
      select
        ${holdingSnapshots.id} as id,
        row_number() over (
          partition by
            ${holdingSnapshots.householdId},
            ${holdingSnapshots.accountId},
            ${holdingSnapshots.snapshotDate},
            ${instruments.assetClass},
            coalesce(upper(${instruments.symbol}), lower(${instruments.name})),
            ${holdingSnapshots.currency},
            ${holdingSnapshots.quantity},
            ${holdingSnapshots.investedAmount},
            ${holdingSnapshots.currentValue}
          order by
            ${holdingSnapshots.snapshotDate} desc,
            case
              when ${holdingSnapshots.sourcePayload} ? 'sourceSheet' then 0
              else 1
            end,
            ${holdingSnapshots.createdAt} desc,
            ${holdingSnapshots.id} desc
        ) as duplicate_rank
      from ${holdingSnapshots}
      inner join ${instruments} on ${holdingSnapshots.instrumentId} = ${instruments.id}
      where ${holdingSnapshots.householdId} = ${membership.householdId}
        and ${instruments.assetClass} in ('indian_stock', 'us_stock')
    )
    delete from ${holdingSnapshots}
    using ranked
    where ${holdingSnapshots.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${holdingSnapshots.id}
  `);

    const deletedTransactions = await tx.execute(sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by household_id, account_id, instrument_id, trade_date, type, quantity, price, amount, currency
          order by created_at desc, id desc
        ) as duplicate_rank
      from ${transactions}
      where household_id = ${membership.householdId}
    )
    delete from ${transactions}
    using ranked
    where ${transactions.id} = ranked.id
      and ranked.duplicate_rank > 1
    returning ${transactions.id}
  `);

    return {
      deletedAggregateHoldingSnapshots: deletedAggregateHoldingSnapshots.length,
      deletedHoldingSnapshots: deletedHoldingSnapshots.length,
      deletedSemanticHoldingSnapshots: deletedSemanticHoldingSnapshots.length,
      deletedCrossSourceStockSnapshots: deletedCrossSourceStockSnapshots.length,
      deletedTransactions: deletedTransactions.length,
    };
  });

  clearHouseholdPortfolioCache(membership.householdId);

  return result;
}
