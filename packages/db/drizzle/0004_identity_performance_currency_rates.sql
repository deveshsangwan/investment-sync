CREATE TABLE IF NOT EXISTS "currency_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base" "currency" NOT NULL,
  "quote" "currency" NOT NULL,
  "rate" numeric(28, 10) NOT NULL,
  "provider" text NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "currency_rates_pair_provider_idx"
  ON "currency_rates" USING btree ("base", "quote", "provider");
--> statement-breakpoint
WITH account_identity_map AS (
  SELECT
    id AS duplicate_id,
    first_value(id) OVER (
      PARTITION BY household_id, lower(provider), lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM accounts
),
ranked_holding_snapshots AS (
  SELECT
    holding_snapshots.id,
    row_number() OVER (
      PARTITION BY
        holding_snapshots.household_id,
        coalesce(account_identity_map.canonical_id, holding_snapshots.account_id),
        holding_snapshots.instrument_id,
        holding_snapshots.snapshot_date,
        holding_snapshots.currency
      ORDER BY holding_snapshots.created_at DESC, holding_snapshots.id DESC
    ) AS duplicate_rank
  FROM holding_snapshots
  LEFT JOIN account_identity_map
    ON holding_snapshots.account_id = account_identity_map.duplicate_id
)
DELETE FROM holding_snapshots
USING ranked_holding_snapshots
WHERE holding_snapshots.id = ranked_holding_snapshots.id
  AND ranked_holding_snapshots.duplicate_rank > 1;
--> statement-breakpoint
WITH account_identity_map AS (
  SELECT
    id AS duplicate_id,
    first_value(id) OVER (
      PARTITION BY household_id, lower(provider), lower(name)
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM accounts
),
ranked_transactions AS (
  SELECT
    transactions.id,
    row_number() OVER (
      PARTITION BY
        transactions.household_id,
        coalesce(account_identity_map.canonical_id, transactions.account_id),
        transactions.instrument_id,
        transactions.trade_date,
        transactions.type,
        transactions.amount,
        transactions.currency
      ORDER BY transactions.created_at DESC, transactions.id DESC
    ) AS duplicate_rank
  FROM transactions
  LEFT JOIN account_identity_map
    ON transactions.account_id = account_identity_map.duplicate_id
)
DELETE FROM transactions
USING ranked_transactions
WHERE transactions.id = ranked_transactions.id
  AND ranked_transactions.duplicate_rank > 1;
--> statement-breakpoint
WITH account_identity_map AS (
  SELECT duplicate_id, canonical_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY household_id, lower(provider), lower(name)
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM accounts
  ) ranked
  WHERE duplicate_id <> canonical_id
)
UPDATE holding_snapshots
SET account_id = account_identity_map.canonical_id
FROM account_identity_map
WHERE holding_snapshots.account_id = account_identity_map.duplicate_id;
--> statement-breakpoint
WITH account_identity_map AS (
  SELECT duplicate_id, canonical_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY household_id, lower(provider), lower(name)
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM accounts
  ) ranked
  WHERE duplicate_id <> canonical_id
)
UPDATE transactions
SET account_id = account_identity_map.canonical_id
FROM account_identity_map
WHERE transactions.account_id = account_identity_map.duplicate_id;
--> statement-breakpoint
WITH account_identity_map AS (
  SELECT duplicate_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY household_id, lower(provider), lower(name)
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM accounts
  ) ranked
  WHERE duplicate_id <> canonical_id
)
DELETE FROM accounts
USING account_identity_map
WHERE accounts.id = account_identity_map.duplicate_id;
--> statement-breakpoint
WITH instrument_identity_map AS (
  SELECT
    id AS duplicate_id,
    first_value(id) OVER (
      PARTITION BY
        asset_class,
        currency,
        CASE WHEN symbol IS NULL THEN 'name' ELSE 'symbol' END,
        CASE WHEN symbol IS NULL THEN lower(name) ELSE upper(symbol) END
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM instruments
),
ranked_holding_snapshots AS (
  SELECT
    holding_snapshots.id,
    row_number() OVER (
      PARTITION BY
        holding_snapshots.household_id,
        holding_snapshots.account_id,
        coalesce(instrument_identity_map.canonical_id, holding_snapshots.instrument_id),
        holding_snapshots.snapshot_date,
        holding_snapshots.currency
      ORDER BY holding_snapshots.created_at DESC, holding_snapshots.id DESC
    ) AS duplicate_rank
  FROM holding_snapshots
  LEFT JOIN instrument_identity_map
    ON holding_snapshots.instrument_id = instrument_identity_map.duplicate_id
)
DELETE FROM holding_snapshots
USING ranked_holding_snapshots
WHERE holding_snapshots.id = ranked_holding_snapshots.id
  AND ranked_holding_snapshots.duplicate_rank > 1;
--> statement-breakpoint
WITH instrument_identity_map AS (
  SELECT
    id AS duplicate_id,
    first_value(id) OVER (
      PARTITION BY
        asset_class,
        currency,
        CASE WHEN symbol IS NULL THEN 'name' ELSE 'symbol' END,
        CASE WHEN symbol IS NULL THEN lower(name) ELSE upper(symbol) END
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM instruments
),
ranked_transactions AS (
  SELECT
    transactions.id,
    row_number() OVER (
      PARTITION BY
        transactions.household_id,
        transactions.account_id,
        coalesce(instrument_identity_map.canonical_id, transactions.instrument_id),
        transactions.trade_date,
        transactions.type,
        transactions.amount,
        transactions.currency
      ORDER BY transactions.created_at DESC, transactions.id DESC
    ) AS duplicate_rank
  FROM transactions
  LEFT JOIN instrument_identity_map
    ON transactions.instrument_id = instrument_identity_map.duplicate_id
)
DELETE FROM transactions
USING ranked_transactions
WHERE transactions.id = ranked_transactions.id
  AND ranked_transactions.duplicate_rank > 1;
--> statement-breakpoint
WITH instrument_identity_map AS (
  SELECT duplicate_id, canonical_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY
          asset_class,
          currency,
          CASE WHEN symbol IS NULL THEN 'name' ELSE 'symbol' END,
          CASE WHEN symbol IS NULL THEN lower(name) ELSE upper(symbol) END
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM instruments
  ) ranked
  WHERE duplicate_id <> canonical_id
)
UPDATE holding_snapshots
SET instrument_id = instrument_identity_map.canonical_id
FROM instrument_identity_map
WHERE holding_snapshots.instrument_id = instrument_identity_map.duplicate_id;
--> statement-breakpoint
WITH instrument_identity_map AS (
  SELECT duplicate_id, canonical_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY
          asset_class,
          currency,
          CASE WHEN symbol IS NULL THEN 'name' ELSE 'symbol' END,
          CASE WHEN symbol IS NULL THEN lower(name) ELSE upper(symbol) END
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM instruments
  ) ranked
  WHERE duplicate_id <> canonical_id
)
UPDATE transactions
SET instrument_id = instrument_identity_map.canonical_id
FROM instrument_identity_map
WHERE transactions.instrument_id = instrument_identity_map.duplicate_id;
--> statement-breakpoint
WITH instrument_identity_map AS (
  SELECT duplicate_id
  FROM (
    SELECT
      id AS duplicate_id,
      first_value(id) OVER (
        PARTITION BY
          asset_class,
          currency,
          CASE WHEN symbol IS NULL THEN 'name' ELSE 'symbol' END,
          CASE WHEN symbol IS NULL THEN lower(name) ELSE upper(symbol) END
        ORDER BY created_at ASC, id ASC
      ) AS canonical_id
    FROM instruments
  ) ranked
  WHERE duplicate_id <> canonical_id
)
DELETE FROM instruments
USING instrument_identity_map
WHERE instruments.id = instrument_identity_map.duplicate_id;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_household_provider_name_identity_idx"
  ON "accounts" USING btree ("household_id", lower("provider"), lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instruments_symbol_identity_idx"
  ON "instruments" USING btree ("asset_class", "currency", upper("symbol"))
  WHERE "symbol" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instruments_name_identity_idx"
  ON "instruments" USING btree ("asset_class", "currency", lower("name"))
  WHERE "symbol" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_household_provider_name_idx"
  ON "accounts" USING btree ("household_id", "provider", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instruments_identity_lookup_idx"
  ON "instruments" USING btree ("asset_class", "currency", "symbol", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holding_snapshots_household_date_idx"
  ON "holding_snapshots" USING btree ("household_id", "snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holding_snapshots_household_instrument_date_idx"
  ON "holding_snapshots" USING btree ("household_id", "instrument_id", "snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_household_instrument_date_idx"
  ON "transactions" USING btree ("household_id", "instrument_id", "trade_date");
