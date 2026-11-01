CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_type" "import_source" NOT NULL,
	"snapshot_date" date NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"currency" "currency" NOT NULL,
	"source_group" text NOT NULL,
	"completeness" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"source_sequence" bigint NOT NULL,
	"parser_version" text NOT NULL,
	"fallback_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "source_sequence" bigint;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_batch_row_idx" ON "source_snapshots" USING btree ("import_batch_id","row_number");--> statement-breakpoint
CREATE INDEX "source_snapshots_scope_date_idx" ON "source_snapshots" USING btree ("household_id","account_id","asset_class","currency","source_group","snapshot_date");--> statement-breakpoint
CREATE INDEX "source_snapshots_sequence_idx" ON "source_snapshots" USING btree ("source_sequence");