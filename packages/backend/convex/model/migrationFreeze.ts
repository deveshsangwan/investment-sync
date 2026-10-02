export function hasMigrationWriteFreeze() {
  return Boolean(process.env.MIGRATION_MODE);
}

export function requireApplicationWritesEnabled() {
  if (hasMigrationWriteFreeze())
    throw new Error(
      "Application writes are disabled during migration verification",
    );
}
