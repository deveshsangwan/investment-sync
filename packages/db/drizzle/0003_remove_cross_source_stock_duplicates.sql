WITH ranked_cross_source_stock_snapshots AS (
  SELECT
    holding_snapshots.id,
    row_number() OVER (
      PARTITION BY
        holding_snapshots.household_id,
        instruments.asset_class,
        coalesce(upper(instruments.symbol), lower(instruments.name)),
        holding_snapshots.currency,
        holding_snapshots.quantity,
        holding_snapshots.invested_amount,
        holding_snapshots.current_value
      ORDER BY
        holding_snapshots.snapshot_date DESC,
        CASE
          WHEN holding_snapshots.source_payload ? 'sourceSheet' THEN 0
          ELSE 1
        END,
        holding_snapshots.created_at DESC,
        holding_snapshots.id DESC
    ) AS duplicate_rank
  FROM holding_snapshots
  INNER JOIN instruments ON holding_snapshots.instrument_id = instruments.id
  WHERE instruments.asset_class IN ('indian_stock', 'us_stock')
)
DELETE FROM holding_snapshots
USING ranked_cross_source_stock_snapshots
WHERE holding_snapshots.id = ranked_cross_source_stock_snapshots.id
  AND ranked_cross_source_stock_snapshots.duplicate_rank > 1;
