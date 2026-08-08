INSERT INTO "holding_snapshots" (
	"household_id",
	"account_id",
	"instrument_id",
	"import_batch_id",
	"source_type",
	"snapshot_date",
	"quantity",
	"invested_amount",
	"current_value",
	"pnl_amount",
	"pnl_percent",
	"currency",
	"source_payload"
)
SELECT
	batch."household_id",
	account."id",
	instrument."id",
	batch."id",
	batch."source_type",
	coalesce(
		nullif(row."normalized_payload"->>'sourceDate', '')::date,
		batch."uploaded_at"::date
	),
	nullif(row."normalized_payload"->>'quantity', '')::numeric,
	(row."normalized_payload"->>'investedAmount')::numeric,
	(row."normalized_payload"->>'currentValue')::numeric,
	nullif(row."normalized_payload"->>'pnlAmount', '')::numeric,
	nullif(row."normalized_payload"->>'pnlPercent', '')::numeric,
	(row."normalized_payload"->>'currency')::"currency",
	coalesce(row."normalized_payload"->'metadata', '{}'::jsonb)
FROM "import_rows" row
INNER JOIN "import_batches" batch
	ON batch."id" = row."import_batch_id"
INNER JOIN LATERAL (
	SELECT "accounts"."id"
	FROM "accounts"
	WHERE "accounts"."household_id" = batch."household_id"
		AND lower(trim("accounts"."name")) = lower(trim(row."normalized_payload"->>'accountName'))
		AND lower(trim("accounts"."provider")) = lower(trim(row."normalized_payload"->>'provider'))
	ORDER BY "accounts"."created_at", "accounts"."id"
	LIMIT 1
) account ON true
INNER JOIN LATERAL (
	SELECT "instruments"."id"
	FROM "instruments"
	WHERE "instruments"."asset_class"::text = row."normalized_payload"->>'assetClass'
		AND "instruments"."currency"::text = row."normalized_payload"->>'currency'
		AND lower(trim("instruments"."name")) = lower(trim(row."normalized_payload"->>'instrumentName'))
	ORDER BY "instruments"."created_at", "instruments"."id"
	LIMIT 1
) instrument ON true
WHERE row."is_committed" = true
	AND batch."source_type" = 'investment_portfolio_xlsx'
	AND row."normalized_payload"->>'kind' = 'holding'
	AND lower(trim(row."normalized_payload"->>'accountName')) = 'epf'
ON CONFLICT (
	"household_id",
	"account_id",
	"instrument_id",
	"snapshot_date",
	"currency"
) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "import_rows" row
		INNER JOIN "import_batches" batch
			ON batch."id" = row."import_batch_id"
		WHERE row."is_committed" = true
			AND batch."source_type" = 'investment_portfolio_xlsx'
			AND row."normalized_payload"->>'kind' = 'holding'
			AND lower(trim(row."normalized_payload"->>'accountName')) = 'epf'
			AND NOT EXISTS (
				SELECT 1
				FROM "holding_snapshots" snapshot
				INNER JOIN "accounts" account
					ON account."id" = snapshot."account_id"
				INNER JOIN "instruments" instrument
					ON instrument."id" = snapshot."instrument_id"
				WHERE snapshot."household_id" = batch."household_id"
					AND snapshot."snapshot_date" = coalesce(
						nullif(row."normalized_payload"->>'sourceDate', '')::date,
						batch."uploaded_at"::date
					)
					AND snapshot."currency"::text = row."normalized_payload"->>'currency'
					AND lower(trim(account."name")) = lower(trim(row."normalized_payload"->>'accountName'))
					AND lower(trim(account."provider")) = lower(trim(row."normalized_payload"->>'provider'))
					AND instrument."asset_class"::text = row."normalized_payload"->>'assetClass'
					AND lower(trim(instrument."name")) = lower(trim(row."normalized_payload"->>'instrumentName'))
			)
	)
	THEN
		RAISE EXCEPTION 'Failed to restore a committed workbook EPF snapshot';
	END IF;
END $$;
