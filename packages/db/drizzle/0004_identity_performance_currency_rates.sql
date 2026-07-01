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
