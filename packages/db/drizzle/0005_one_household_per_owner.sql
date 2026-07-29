-- Makes first-login provisioning idempotent: concurrent requests can no longer
-- create a second household for the same owner.
--
-- If this fails with a uniqueness violation, duplicate households already exist
-- and must be merged by hand before applying. Failing loudly is deliberate --
-- automatically deleting a duplicate household would discard portfolio history.
CREATE UNIQUE INDEX IF NOT EXISTS "households_owner_user_idx"
  ON "households" USING btree ("owner_user_id");
