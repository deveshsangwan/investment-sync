import { afterEach, expect, it, vi } from "vitest";
import type { PortfolioFact } from "@investment-sync/portfolio-domain";
import { internal } from "./_generated/api";
import { decodeFact } from "./model/portfolioEncoding";
import { migrate, quote, runKey, uuid } from "../test/migrationFixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("rejects altered full holding facts while their published views remain unchanged", async () => {
  const t = await migrate();
  const viewArgs = {
    runKey,
    legacyHouseholdId: uuid(11),
    view: "positions" as const,
    quote,
  };
  const before = await t.query(internal.migrationViews.portfolioView, viewArgs);
  expect((await t.action(internal.migrationAudit.audit, { runKey })).ok).toBe(
    true,
  );
  const doc = await t.run(async (ctx) =>
    (await ctx.db.query("holdingSnapshots").collect()).find(
      (row) => row.legacyId === uuid(71),
    ),
  );
  if (!doc) throw new Error("Missing migrated holding");
  const mutations: Array<(fact: PortfolioFact) => void> = [
    (fact) => {
      fact.row.metadata.changed = true;
    },
    (fact) => {
      fact.row.source.completeness = "partial";
    },
    (fact) => {
      fact.row.source.group = "other-source";
    },
    (fact) => {
      fact.row.source.priority += 1;
    },
    (fact) => {
      fact.row.source.granularity = "asset_class";
    },
    (fact) => {
      fact.row.numericProvenance.currentValue = "legacy_float64";
    },
    (fact) => {
      fact.provenance.parserVersion = "changed-parser";
    },
    (fact) => {
      fact.provenance.sequence += 1;
    },
    (fact) => {
      fact.provenance.rowNumber += 1;
    },
    (fact) => {
      fact.provenance.fallbackDate = "2025-05-02";
    },
    (fact) => {
      fact.provenance.batchId = "other-batch";
    },
    (fact) => {
      if (fact.row.kind !== "holding") throw new Error("Expected holding");
      fact.row.isin = "CHANGED";
    },
  ];

  for (const mutate of mutations) {
    const fact = decodeFact(doc.factJson);
    mutate(fact);
    await t.run((ctx) =>
      ctx.db.patch("holdingSnapshots", doc._id, {
        factJson: JSON.stringify(fact),
      }),
    );
    const audit = await t.action(internal.migrationAudit.audit, { runKey });
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((finding) => finding.includes(uuid(71)))).toBe(
      true,
    );
    expect(await t.query(internal.migrationViews.portfolioView, viewArgs)).toBe(
      before,
    );
  }

  await t.run((ctx) =>
    ctx.db.patch("holdingSnapshots", doc._id, { factJson: doc.factJson }),
  );
  expect((await t.action(internal.migrationAudit.audit, { runKey })).ok).toBe(
    true,
  );
});

it.each(["transactions", "portfolioValuations"] as const)(
  "binds full %s metadata and provenance to the source",
  async (table) => {
    const t = await migrate();
    const doc = await t.run((ctx) => ctx.db.query(table).first());
    if (!doc) throw new Error("Missing migrated financial fact");
    const fact = decodeFact(doc.factJson);
    fact.row.metadata.changed = true;
    fact.provenance.parserVersion = "changed-parser";
    await t.run((ctx) =>
      ctx.db.patch(table, doc._id, { factJson: JSON.stringify(fact) }),
    );

    const audit = await t.action(internal.migrationAudit.audit, { runKey });
    expect(audit.ok).toBe(false);
    expect(
      audit.findings.some((finding) => finding.includes(String(doc.legacyId))),
    ).toBe(true);
  },
);

it("binds stored identity keys and legacy aliases independently of cached views", async () => {
  const t = await migrate();
  const doc = await t.run(async (ctx) =>
    (await ctx.db.query("holdingSnapshots").collect()).find(
      (row) => row.legacyId === uuid(71),
    ),
  );
  if (!doc) throw new Error("Missing migrated holding");

  for (const field of [
    "key",
    "positionKey",
    "instrumentKey",
    "sourceGroupKey",
    "date",
  ] as const) {
    await t.run((ctx) =>
      ctx.db.patch("holdingSnapshots", doc._id, { [field]: "changed" }),
    );
    expect((await t.action(internal.migrationAudit.audit, { runKey })).ok).toBe(
      false,
    );
    await t.run((ctx) =>
      ctx.db.patch("holdingSnapshots", doc._id, { [field]: doc[field] }),
    );
  }
  const alias = await t.run((ctx) =>
    ctx.db
      .query("legacyHoldingAliases")
      .withIndex("by_householdId_and_legacyId", (q) =>
        q.eq("householdId", doc.householdId).eq("legacyId", uuid(71)),
      )
      .unique(),
  );
  if (!alias) throw new Error("Missing legacy holding alias");
  await t.run((ctx) =>
    ctx.db.patch("legacyHoldingAliases", alias._id, { positionKey: "changed" }),
  );
  expect((await t.action(internal.migrationAudit.audit, { runKey })).ok).toBe(
    false,
  );
});

it("requires the separately archived fact ordinal", async () => {
  const t = await migrate();
  const record = await t.run((ctx) =>
    ctx.db
      .query("migrationRecords")
      .withIndex("by_runKey_and_legacyTable_and_legacyId", (q) =>
        q
          .eq("runKey", runKey)
          .eq("legacyTable", "holding_snapshots")
          .eq("legacyId", uuid(71)),
      )
      .unique(),
  );
  if (!record) throw new Error("Missing archived holding source");
  await t.run((ctx) =>
    ctx.db.patch("migrationRecords", record._id, { rowNumber: undefined }),
  );

  expect((await t.action(internal.migrationAudit.audit, { runKey })).ok).toBe(
    false,
  );
});
