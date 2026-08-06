DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM import_batches
    WHERE status = 'committed'
      AND file_hash IS NOT NULL
      AND parser_version IS NOT NULL
    GROUP BY household_id, file_hash, parser_version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate committed imports exist; resolve household_id/file_hash/parser_version duplicates before migrating';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_committed_file_parser_idx"
  ON "import_batches" USING btree ("household_id", "file_hash", "parser_version")
  WHERE "import_batches"."status" = 'committed';
