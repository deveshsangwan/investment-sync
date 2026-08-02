-- The Crypto workbook sheet records rupee amounts (Invested / Total Asset
-- Value); only its Units column is denominated in the coin. Those rows were
-- tagged OTHER, and portfolio totals only added them up because convertToInr
-- passed unsupported currencies through as INR.
--
-- convertToInr now excludes unsupported currencies, so the existing crypto rows
-- must be relabelled to the currency their amounts were always in, otherwise
-- they would silently drop out of every total.
UPDATE "holding_snapshots" AS hs
SET "currency" = 'INR'
FROM "instruments" AS i
WHERE hs."instrument_id" = i."id"
  AND i."asset_class" = 'crypto'
  AND hs."currency" = 'OTHER';
--> statement-breakpoint
UPDATE "transactions" AS t
SET "currency" = 'INR'
FROM "instruments" AS i
WHERE t."instrument_id" = i."id"
  AND i."asset_class" = 'crypto'
  AND t."currency" = 'OTHER';
--> statement-breakpoint
UPDATE "instruments"
SET "currency" = 'INR', "updated_at" = now()
WHERE "asset_class" = 'crypto'
  AND "currency" = 'OTHER';
--> statement-breakpoint
-- Import batches parsed before this deploy still carry currency OTHER inside
-- normalized_payload, and commitImport inserts payload.currency verbatim. Left
-- alone, committing one of those in-flight batches would recreate exactly the
-- excluded rows the statements above just repaired.
UPDATE "import_rows"
SET "normalized_payload" = jsonb_set("normalized_payload", '{currency}', '"INR"')
WHERE "normalized_payload"->>'currency' = 'OTHER'
  AND "normalized_payload"->>'assetClass' = 'crypto';
--> statement-breakpoint
-- ensureAccounts stamps the account with the row's currency, so importer-created
-- Crypto accounts carry OTHER too. Not used in totals, but leaving it behind
-- makes the account disagree with every snapshot under it.
UPDATE "accounts"
SET "currency" = 'INR', "updated_at" = now()
WHERE "account_type" = 'crypto'
  AND "currency" = 'OTHER';
