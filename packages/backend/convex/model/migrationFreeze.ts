import { ConvexError } from "convex/values";

export function hasMigrationWriteFreeze() {
  return Boolean(process.env.MIGRATION_MODE);
}

export function requireApplicationWritesEnabled() {
  if (hasMigrationWriteFreeze())
    throw new ConvexError({
      code: "SOURCE_WRITES_PAUSED",
      message: "Application writes are disabled during migration verification",
    });
}
