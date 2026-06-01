DELETE FROM holding_snapshots
USING instruments
WHERE holding_snapshots.instrument_id = instruments.id
  AND (
    holding_snapshots.source_payload->>'isAggregate' = 'true'
    OR holding_snapshots.source_payload->>'sourceSheet' = 'Investment Portfolio'
    OR instruments.name ILIKE '% Summary'
  );

WITH ranked_semantic_holding_snapshots AS (
  SELECT
    holding_snapshots.id,
    row_number() OVER (
      PARTITION BY
        holding_snapshots.household_id,
        lower(accounts.name),
        lower(accounts.provider),
        holding_snapshots.snapshot_date,
        holding_snapshots.currency,
        coalesce(holding_snapshots.source_payload->>'sourceSheet', ''),
        coalesce(upper(instruments.symbol), lower(instruments.name))
      ORDER BY holding_snapshots.created_at DESC, holding_snapshots.id DESC
    ) AS duplicate_rank
  FROM holding_snapshots
  INNER JOIN accounts ON holding_snapshots.account_id = accounts.id
  INNER JOIN instruments ON holding_snapshots.instrument_id = instruments.id
)
DELETE FROM holding_snapshots
USING ranked_semantic_holding_snapshots
WHERE holding_snapshots.id = ranked_semantic_holding_snapshots.id
  AND ranked_semantic_holding_snapshots.duplicate_rank > 1;
