import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must be set in CI for migration tests");
}
const describeDb = testDatabaseUrl ? describe : describe.skip;

describeDb("NPS account normalization migration", () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(() => {
    client = postgres(testDatabaseUrl as string, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client.end();
  });

  it("merges colliding accounts and rewrites pending workbook rows", async () => {
    const migration = readFileSync(
      new URL("../drizzle/0009_normalize_nps_provider.sql", import.meta.url),
      "utf8",
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    const ids = migrationIds();

    await client.begin(async (tx) => {
      await tx`
        insert into users (id, clerk_user_id)
        values (${ids.userA}, ${`migration-${ids.userA}`}),
               (${ids.userB}, ${`migration-${ids.userB}`})
      `;
      await tx`
        insert into households (id, name, owner_user_id)
        values (${ids.householdA}, 'Collision', ${ids.userA}),
               (${ids.householdB}, 'Legacy only', ${ids.userB})
      `;
      await tx`
        insert into instruments (id, name, asset_class, currency)
        values (${ids.instrument}, 'NPS', 'nps', 'INR')
      `;
      await tx`
        insert into accounts (id, household_id, name, provider, account_type)
        values (${ids.legacyAccount}, ${ids.householdA}, 'NPS', 'Manual', 'retirement'),
               (${ids.workbookAccount}, ${ids.householdA}, 'NPS', 'Manual Workbook', 'nps'),
               (${ids.targetAccount}, ${ids.householdA}, 'NPS', 'NPS', 'nps'),
               (${ids.onlyLegacyAccount}, ${ids.householdB}, 'NPS', 'Manual', 'retirement')
      `;
      await tx`
        insert into import_batches (
          id, household_id, uploaded_by_user_id, source_type, status,
          original_file_name, row_count, expires_at
        ) values
          (
            ${ids.workbookBatch}, ${ids.householdA}, ${ids.userA},
            'investment_portfolio_xlsx', 'parsed', 'portfolio.xlsx', 1, now() + interval '1 day'
          ),
          (
            ${ids.portalBatch}, ${ids.householdA}, ${ids.userA},
            'nps_csv', 'committed', 'statement.csv', 1, now() + interval '1 day'
          )
      `;
      await tx`
        insert into import_rows (import_batch_id, row_number, normalized_payload)
        values (
          ${ids.workbookBatch},
          1,
          ${tx.json({
            kind: "holding",
            assetClass: "nps",
            accountName: "NPS",
            provider: "Manual Workbook",
          })}
        )
      `;
      await tx`
        insert into holding_snapshots (
          id, household_id, account_id, instrument_id, snapshot_date,
          import_batch_id, invested_amount, current_value, currency
        ) values
          (${randomUUID()}, ${ids.householdA}, ${ids.targetAccount}, ${ids.instrument}, '2026-08-08', ${ids.workbookBatch}, 100, 100, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.legacyAccount}, ${ids.instrument}, '2026-08-08', ${ids.portalBatch}, 100, 200, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.workbookAccount}, ${ids.instrument}, '2026-07-08', ${ids.workbookBatch}, 80, 90, 'INR')
      `;
      await tx`
        insert into transactions (
          id, household_id, account_id, instrument_id, type, trade_date, amount, currency
        ) values
          (${randomUUID()}, ${ids.householdA}, ${ids.targetAccount}, ${ids.instrument}, 'contribution', '2026-08-01', 10, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.legacyAccount}, ${ids.instrument}, 'contribution', '2026-08-01', 10, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.legacyAccount}, ${ids.instrument}, 'contribution', '2026-07-01', 20, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.targetAccount}, null, 'contribution', '2026-06-01', 30, 'INR'),
          (${randomUUID()}, ${ids.householdA}, ${ids.legacyAccount}, null, 'contribution', '2026-06-01', 30, 'INR')
      `;

      for (const statement of statements) await tx.unsafe(statement);

      const collisionAccounts = await tx<
        Array<{ id: string; provider: string; accountType: string }>
      >`
        select id::text, provider, account_type as "accountType" from accounts
        where household_id = ${ids.householdA}
      `;
      expect(collisionAccounts).toEqual([
        { id: ids.targetAccount, provider: "NPS", accountType: "nps" },
      ]);

      const snapshots = await tx<
        Array<{ accountId: string; currentValue: string }>
      >`
        select account_id::text as "accountId", current_value::text as "currentValue"
        from holding_snapshots
        where household_id = ${ids.householdA}
        order by snapshot_date
      `;
      expect(snapshots).toEqual([
        { accountId: ids.targetAccount, currentValue: "90.0000" },
        { accountId: ids.targetAccount, currentValue: "200.0000" },
      ]);

      const transactionAccounts = await tx<Array<{ accountId: string }>>`
        select account_id::text as "accountId"
        from transactions
        where household_id = ${ids.householdA}
          and instrument_id is not null
        order by trade_date
      `;
      expect(transactionAccounts).toEqual([
        { accountId: ids.targetAccount },
        { accountId: ids.targetAccount },
      ]);

      const nullInstrumentTransactions = await tx<Array<{ accountId: string }>>`
        select account_id::text as "accountId"
        from transactions
        where household_id = ${ids.householdA}
          and instrument_id is null
      `;
      expect(nullInstrumentTransactions).toEqual([
        { accountId: ids.targetAccount },
        { accountId: ids.targetAccount },
      ]);

      const [pendingRow] = await tx<Array<{ provider: string }>>`
        select normalized_payload->>'provider' as provider
        from import_rows
        where import_batch_id = ${ids.workbookBatch}
      `;
      expect(pendingRow?.provider).toBe("NPS");

      const [legacyOnly] = await tx<
        Array<{ provider: string; accountType: string }>
      >`
        select provider, account_type as "accountType"
        from accounts where id = ${ids.onlyLegacyAccount}
      `;
      expect(legacyOnly).toEqual({ provider: "NPS", accountType: "nps" });

      await tx`delete from users where id in (${ids.userA}, ${ids.userB})`;
      await tx`delete from instruments where id = ${ids.instrument}`;
    });
  });
});

function migrationIds() {
  return {
    userA: randomUUID(),
    userB: randomUUID(),
    householdA: randomUUID(),
    householdB: randomUUID(),
    instrument: randomUUID(),
    legacyAccount: randomUUID(),
    workbookAccount: randomUUID(),
    targetAccount: randomUUID(),
    onlyLegacyAccount: randomUUID(),
    workbookBatch: randomUUID(),
    portalBatch: randomUUID(),
  };
}
