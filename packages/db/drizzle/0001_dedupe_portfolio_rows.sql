WITH ranked_holding_snapshots AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY household_id, account_id, instrument_id, snapshot_date, currency
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM holding_snapshots
)
DELETE FROM holding_snapshots
USING ranked_holding_snapshots
WHERE holding_snapshots.id = ranked_holding_snapshots.id
  AND ranked_holding_snapshots.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS holding_snapshots_import_dedupe_idx
  ON holding_snapshots (
    household_id,
    account_id,
    instrument_id,
    snapshot_date,
    currency
  );

WITH ranked_transactions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY household_id, account_id, instrument_id, trade_date, type, amount, currency
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM transactions
)
DELETE FROM transactions
USING ranked_transactions
WHERE transactions.id = ranked_transactions.id
  AND ranked_transactions.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_dedupe_idx
  ON transactions (
    household_id,
    account_id,
    instrument_id,
    trade_date,
    type,
    amount,
    currency
  );
