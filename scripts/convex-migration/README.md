# Phase 0 inventory commands

These commands collect aggregates. They do not migrate data.

Use explicit environment files made for production inventory. The scripts never load `.env.local`, `apps/web/.env.local`, or package-local files. The Postgres command refuses local URLs and opens one repeatable-read, read-only transaction. Storage correlation requires separate database and Storage files so development Storage credentials cannot leak in through an environment cascade.

```text
pnpm migration:inventory:postgres -- --target production --env-file <operator-file> --run-id <run-id>
pnpm migration:inventory:storage -- --target production --database-env-file <database-operator-file> --storage-env-file <storage-operator-file> --run-id <run-id>
pnpm migration:capacity-note -- --run-id <run-id>
```

The first two commands write mode-0600 JSON under `.migration/<run-id>/`. Git ignores that directory. Console output contains no connection details, record identities, object paths, file hashes, or financial values.

The Storage inventory correlates every database-referenced path with the bucket listing. It downloads only referenced available objects, verifies the database hash and Storage byte metadata, and parses each file through the existing importer. The source schema has no database byte-size column, so the protected report records that comparison as unavailable.

The generated capacity note contains aggregate counts only. Once all production evidence matches, it records candidate ceilings with 50 percent headroom and the twice-largest synthetic fixture specification. Phase 3 remains the gate that measures Convex runtime limits.

The generator requires matching run IDs and database fingerprints, supported artifact schemas, a Storage fingerprint, and collection timestamps no more than 24 hours apart with Storage collected after Postgres. Every nonzero integrity, collision, or Storage finding blocks candidates unless `.migration/<run-id>/dispositions.json` records this constrained form:

```json
{
  "schemaVersion": 1,
  "runId": "<run-id>",
  "findings": [
    {
      "check": "<finding_key>",
      "disposition": "accepted_source_state",
      "reasonCode": "<sanitized_reason_code>"
    }
  ]
}
```

Finding keys and reason codes accept lowercase letters, digits, and underscores only. This prevents a disposition from carrying record identities or financial details into the committed note.
