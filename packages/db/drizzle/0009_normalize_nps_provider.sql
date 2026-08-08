CREATE TEMP TABLE "nps_canonical_account" ON COMMIT DROP AS
SELECT DISTINCT ON (candidate."household_id")
  candidate."household_id",
  candidate."id" AS "canonical_account_id"
FROM "accounts" candidate
WHERE lower(trim(candidate."name")) = 'nps'
  AND lower(trim(candidate."provider")) IN ('manual', 'manual workbook', 'nps')
  AND lower(trim(candidate."account_type")) IN ('nps', 'retirement')
ORDER BY
  candidate."household_id",
  (lower(trim(candidate."provider")) = 'nps') DESC,
  (lower(trim(candidate."account_type")) = 'nps') DESC,
  candidate."created_at",
  candidate."id";
--> statement-breakpoint
CREATE TEMP TABLE "nps_account_merge" ON COMMIT DROP AS
SELECT
  candidate."id" AS "legacy_account_id",
  canonical."canonical_account_id"
FROM "accounts" candidate
JOIN "nps_canonical_account" canonical
  ON canonical."household_id" = candidate."household_id"
WHERE candidate."id" <> canonical."canonical_account_id"
  AND lower(trim(candidate."name")) = 'nps'
  AND lower(trim(candidate."provider")) IN ('manual', 'manual workbook', 'nps')
  AND lower(trim(candidate."account_type")) IN ('nps', 'retirement');
--> statement-breakpoint
WITH affected_accounts AS (
  SELECT "legacy_account_id" AS "account_id", "canonical_account_id"
  FROM "nps_account_merge"
  UNION
  SELECT "canonical_account_id", "canonical_account_id"
  FROM "nps_account_merge"
), ranked AS (
  SELECT
    snapshot."id",
    row_number() OVER (
      PARTITION BY
        snapshot."household_id",
        affected."canonical_account_id",
        snapshot."instrument_id",
        snapshot."snapshot_date",
        snapshot."currency"
      ORDER BY
        coalesce(batch."source_type"::text = 'nps_csv', false) DESC,
        snapshot."created_at" DESC,
        snapshot."id" DESC
    ) AS "duplicate_rank"
  FROM "holding_snapshots" snapshot
  JOIN affected_accounts affected
    ON affected."account_id" = snapshot."account_id"
  LEFT JOIN "import_batches" batch
    ON batch."id" = snapshot."import_batch_id"
)
DELETE FROM "holding_snapshots" snapshot
USING ranked
WHERE snapshot."id" = ranked."id"
  AND ranked."duplicate_rank" > 1;
--> statement-breakpoint
UPDATE "holding_snapshots" snapshot
SET "account_id" = merge."canonical_account_id"
FROM "nps_account_merge" merge
WHERE snapshot."account_id" = merge."legacy_account_id";
--> statement-breakpoint
WITH affected_accounts AS (
  SELECT "legacy_account_id" AS "account_id", "canonical_account_id"
  FROM "nps_account_merge"
  UNION
  SELECT "canonical_account_id", "canonical_account_id"
  FROM "nps_account_merge"
), ranked AS (
  SELECT
    tx_row."id",
    row_number() OVER (
      PARTITION BY
        tx_row."household_id",
        affected."canonical_account_id",
        tx_row."instrument_id",
        tx_row."trade_date",
        tx_row."type",
        tx_row."amount",
        tx_row."currency"
      ORDER BY tx_row."created_at" DESC, tx_row."id" DESC
    ) AS "duplicate_rank"
  FROM "transactions" tx_row
  JOIN affected_accounts affected
    ON affected."account_id" = tx_row."account_id"
  WHERE tx_row."instrument_id" IS NOT NULL
)
DELETE FROM "transactions" tx_row
USING ranked
WHERE tx_row."id" = ranked."id"
  AND ranked."duplicate_rank" > 1;
--> statement-breakpoint
UPDATE "transactions" tx_row
SET "account_id" = merge."canonical_account_id"
FROM "nps_account_merge" merge
WHERE tx_row."account_id" = merge."legacy_account_id";
--> statement-breakpoint
DELETE FROM "accounts" legacy
USING "nps_account_merge" merge
WHERE legacy."id" = merge."legacy_account_id";
--> statement-breakpoint
UPDATE "accounts" account
SET "name" = 'NPS',
    "provider" = 'NPS',
    "account_type" = 'nps',
    "updated_at" = now()
FROM "nps_canonical_account" canonical
WHERE account."id" = canonical."canonical_account_id";
--> statement-breakpoint
UPDATE "import_rows" row
SET "normalized_payload" = jsonb_set(
  row."normalized_payload",
  '{provider}',
  '"NPS"'::jsonb,
  false
)
FROM "import_batches" batch
WHERE batch."id" = row."import_batch_id"
  AND batch."status" = 'parsed'
  AND row."normalized_payload"->>'assetClass' = 'nps'
  AND lower(trim(row."normalized_payload"->>'accountName')) = 'nps'
  AND lower(trim(row."normalized_payload"->>'provider')) IN ('manual', 'manual workbook');
