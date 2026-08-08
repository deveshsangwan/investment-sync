ALTER TABLE "holding_snapshots" ADD COLUMN "source_type" "import_source" DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
UPDATE "holding_snapshots" snapshot
SET "source_type" = batch."source_type"
FROM "import_batches" batch
WHERE batch."id" = snapshot."import_batch_id";
