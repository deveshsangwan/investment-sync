CREATE TYPE "public"."asset_class" AS ENUM('indian_stock', 'mutual_fund', 'us_stock', 'nps', 'ulip', 'crypto', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('INR', 'USD', 'BTC', 'ETH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('investment_portfolio_xlsx', 'tickertape_stock_csv', 'tickertape_mutual_fund_csv', 'vested_drivewealth_xlsx', 'manual_snapshot', 'cas_pdf', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('created', 'uploaded', 'parsed', 'committed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'dividend', 'fee', 'transfer', 'contribution', 'redemption');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"account_type" text NOT NULL,
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"snapshot_date" date NOT NULL,
	"quantity" numeric(28, 10),
	"invested_amount" numeric(28, 4) NOT NULL,
	"current_value" numeric(28, 4) NOT NULL,
	"pnl_amount" numeric(28, 4),
	"pnl_percent" numeric(12, 6),
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"source_type" "import_source" DEFAULT 'unknown' NOT NULL,
	"status" "import_status" DEFAULT 'created' NOT NULL,
	"parser_version" text,
	"original_file_name" text NOT NULL,
	"storage_path" text,
	"file_hash" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"row_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_committed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text,
	"isin" text,
	"name" text NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"exchange" text,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"invested_amount" numeric(28, 4) NOT NULL,
	"current_value" numeric(28, 4) NOT NULL,
	"pnl_amount" numeric(28, 4) NOT NULL,
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"price_date" date NOT NULL,
	"price" numeric(28, 10) NOT NULL,
	"currency" "currency" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid,
	"import_batch_id" uuid,
	"type" "transaction_type" NOT NULL,
	"trade_date" date NOT NULL,
	"quantity" numeric(28, 10),
	"price" numeric(28, 10),
	"amount" numeric(28, 4) NOT NULL,
	"currency" "currency" DEFAULT 'INR' NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_household_idx" ON "accounts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "holding_snapshots_household_idx" ON "holding_snapshots" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "holding_snapshots_date_idx" ON "holding_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_household_user_idx" ON "household_members" USING btree ("household_id","user_id");--> statement-breakpoint
CREATE INDEX "import_batches_household_idx" ON "import_batches" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "import_batches_expiry_idx" ON "import_batches" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "import_batches_file_hash_idx" ON "import_batches" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "instruments_symbol_idx" ON "instruments" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "instruments_isin_idx" ON "instruments" USING btree ("isin");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_valuations_household_date_idx" ON "portfolio_valuations" USING btree ("household_id","valuation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_instrument_date_source_idx" ON "prices" USING btree ("instrument_id","price_date","source");--> statement-breakpoint
CREATE INDEX "transactions_household_idx" ON "transactions" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_trade_date_idx" ON "transactions" USING btree ("trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_idx" ON "users" USING btree ("clerk_user_id");