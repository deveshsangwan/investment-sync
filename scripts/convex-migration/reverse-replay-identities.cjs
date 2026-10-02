const {
  normalizeSqlTables,
  stableJson,
} = require("./reverse-replay-postgres.cjs");
const {
  TARGET_TABLES,
  date,
  deterministicUuid,
  mapped,
  reject,
  scaled,
  text,
  timestamp,
  unique,
} = require("./reverse-replay-values.cjs");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createIdentityMaps(sourceTables, targetTables, mappings) {
  if (!Array.isArray(mappings)) reject("missing_id_mapping");
  const maps = Object.fromEntries(
    TARGET_TABLES.map((table) => [table, new Map()]),
  );

  for (const mapping of mappings) {
    const sourceRows = sourceTables[mapping.legacyTable];
    const targetRows = targetTables[mapping.targetTable];
    if (!sourceRows || !targetRows || !UUID.test(mapping.legacyId))
      reject("invalid_id_mapping");
    const source = sourceRows.find((row) => row.id === mapping.legacyId);
    const target = targetRows.find((row) => row._id === mapping.targetId);
    if (!source || !target) reject("unresolved_id_mapping");
    if (mapping.sourceJson) {
      const archivedSource = normalizeSqlTables({
        ...sourceTables,
        [mapping.legacyTable]: [JSON.parse(mapping.sourceJson)],
      })[mapping.legacyTable][0];
      if (stableJson(archivedSource) !== stableJson(source))
        reject("divergent_mapping_source");
    }

    const map = maps[mapping.targetTable];
    // Several archived SQL rows can belong to one bounded Convex chunk.
    if (mapping.targetTable === "importRowChunks") continue;
    if (map.has(target._id) && map.get(target._id) !== source.id)
      reject("ambiguous_id_mapping");
    map.set(target._id, source.id);
  }

  return maps;
}

function replayParents({ tables, maps, rowsByTable }) {
  for (const user of tables.users) {
    const id = maps.users.get(user._id) ?? deterministicUuid("users", user._id);
    const baseline = rowsByTable.users.get(id);
    const createdAt = timestamp(user._creationTime);
    const row = baseline
      ? { ...baseline }
      : {
          id,
          clerk_user_id: text(user.clerkSubject),
          email: user.email ?? null,
          created_at: createdAt,
          updated_at: createdAt,
        };
    if (row.clerk_user_id !== user.clerkSubject)
      reject("changed_clerk_identity");
    if (user.email) row.email = text(user.email);
    if (
      [...rowsByTable.users.values()].some(
        (candidate) =>
          candidate.clerk_user_id === row.clerk_user_id && candidate.id !== id,
      )
    )
      reject("clerk_identity_collision");

    maps.users.set(user._id, id);
    rowsByTable.users.set(id, row);
  }

  for (const household of tables.households) {
    const id =
      maps.households.get(household._id) ??
      deterministicUuid("households", household._id);
    const baseline = rowsByTable.households.get(id);
    const createdAt = timestamp(household._creationTime);
    const row = baseline
      ? { ...baseline }
      : {
          id,
          name: text(household.name),
          owner_user_id: mapped(maps.users, household.ownerUserId),
          created_at: createdAt,
          updated_at: createdAt,
        };
    if (row.owner_user_id !== mapped(maps.users, household.ownerUserId))
      reject("changed_household_owner");
    row.name = text(household.name);
    if (
      [...rowsByTable.households.values()].some(
        (candidate) =>
          candidate.owner_user_id === row.owner_user_id && candidate.id !== id,
      )
    )
      reject("household_owner_collision");

    maps.households.set(household._id, id);
    rowsByTable.households.set(id, row);
  }

  for (const member of tables.householdMembers) {
    const id =
      maps.householdMembers.get(member._id) ??
      deterministicUuid("household_members", member._id);
    const baseline = rowsByTable.household_members.get(id);
    const row = baseline
      ? { ...baseline }
      : {
          id,
          household_id: mapped(maps.households, member.householdId),
          user_id: mapped(maps.users, member.userId),
          role: text(member.role),
          created_at: timestamp(member._creationTime),
        };
    if (
      row.household_id !== mapped(maps.households, member.householdId) ||
      row.user_id !== mapped(maps.users, member.userId)
    )
      reject("changed_membership_ownership");
    row.role = text(member.role);

    maps.householdMembers.set(member._id, id);
    rowsByTable.household_members.set(id, row);
  }

  for (const account of tables.accounts) {
    const id =
      maps.accounts.get(account._id) ??
      deterministicUuid("accounts", account._id);
    const baseline = rowsByTable.accounts.get(id);
    const createdAt = timestamp(account._creationTime);
    const row = baseline
      ? { ...baseline }
      : {
          id,
          household_id: mapped(maps.households, account.householdId),
          name: text(account.name),
          provider: text(account.provider),
          account_type: text(account.accountType),
          currency: text(account.currency),
          is_archived: false,
          metadata: {},
          created_at: createdAt,
          updated_at: createdAt,
        };
    if (row.household_id !== mapped(maps.households, account.householdId))
      reject("changed_account_ownership");

    maps.accounts.set(account._id, id);
    rowsByTable.accounts.set(id, row);
  }

  for (const instrument of tables.instruments) {
    mapped(maps.households, instrument.householdId);
    const key = instrumentIdentity(instrument);
    const matches = [...rowsByTable.instruments.values()].filter(
      (candidate) =>
        instrumentIdentity({
          assetClass: candidate.asset_class,
          currency: candidate.currency,
          symbol: candidate.symbol,
          name: candidate.name,
        }) === key,
    );
    if (matches.length > 1) reject("global_instrument_collision");
    const id =
      maps.instruments.get(instrument._id) ??
      matches[0]?.id ??
      deterministicUuid("instruments", instrument._id);
    const baseline = rowsByTable.instruments.get(id);
    const createdAt = timestamp(instrument._creationTime);
    const row = baseline ?? {
      id,
      symbol: instrument.symbol ?? null,
      isin: firstInstrumentIsin(tables, instrument),
      name: text(instrument.name),
      asset_class: text(instrument.assetClass),
      currency: text(instrument.currency),
      exchange: null,
      provider_metadata: {},
      created_at: createdAt,
      updated_at: createdAt,
    };
    if (
      instrumentIdentity({
        assetClass: row.asset_class,
        currency: row.currency,
        symbol: row.symbol,
        name: row.name,
      }) !== key
    )
      reject("changed_instrument_identity");

    maps.instruments.set(instrument._id, id);
    rowsByTable.instruments.set(id, row);
  }
}

function firstInstrumentIsin(tables, instrument) {
  const key = instrumentIdentity(instrument);
  const facts = tables.holdingSnapshots
    .filter((doc) => doc.householdId === instrument.householdId)
    .map((doc) => JSON.parse(text(doc.factJson)))
    .filter(
      (fact) =>
        instrumentIdentity({
          assetClass: fact.row.assetClass,
          currency: fact.row.currency,
          symbol: fact.row.symbol,
          name: fact.row.instrumentName,
        }) === key,
    )
    .sort(
      (a, b) =>
        a.provenance.sequence - b.provenance.sequence ||
        a.provenance.rowNumber - b.provenance.rowNumber,
    );

  return facts[0]?.row.isin?.trim() || null;
}

function transactionUniqueKey(fact, maps, targetTables) {
  const row = fact.row;
  return JSON.stringify([
    mapped(maps.households, fact.doc.householdId),
    findAccountId(fact, maps, targetTables),
    findInstrumentId(fact, maps, targetTables),
    date(row.tradeDate),
    text(row.type),
    scaled(row.amount, 4),
    row.currency,
  ]);
}

function findAccountId(fact, maps, tables) {
  const row = fact.row;
  const account = unique(
    tables.accounts.filter(
      (candidate) =>
        candidate.householdId === fact.doc.householdId &&
        candidate.provider.trim().toLowerCase() ===
          row.provider.trim().toLowerCase() &&
        candidate.name.trim().toLowerCase() ===
          row.accountName.trim().toLowerCase(),
    ),
    "account_identity_collision",
  );
  if (!account) reject("missing_fact_account");
  return mapped(maps.accounts, account._id);
}

function findInstrumentId(fact, maps, tables) {
  const key = instrumentIdentity({
    assetClass: fact.row.assetClass,
    currency: fact.row.currency,
    symbol: fact.row.symbol,
    name: fact.row.instrumentName,
  });
  const instrument = unique(
    tables.instruments.filter(
      (candidate) =>
        candidate.householdId === fact.doc.householdId &&
        instrumentIdentity(candidate) === key,
    ),
    "instrument_identity_collision",
  );
  if (!instrument) reject("missing_fact_instrument");
  return mapped(maps.instruments, instrument._id);
}

function instrumentIdentity(row) {
  const symbol = row.symbol?.trim().toUpperCase();
  return JSON.stringify([
    text(row.assetClass),
    text(row.currency),
    symbol ? "symbol" : "name",
    symbol || text(row.name).trim().toLowerCase(),
  ]);
}

module.exports = {
  createIdentityMaps,
  findAccountId,
  findInstrumentId,
  replayParents,
  transactionUniqueKey,
};
