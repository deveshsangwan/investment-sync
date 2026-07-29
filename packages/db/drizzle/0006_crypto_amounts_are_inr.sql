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
