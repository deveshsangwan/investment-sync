const net = require("node:net");
const nodeCrypto = require("node:crypto");
const { TARGET_TABLES } = require("./reverse-replay-values.cjs");
const {
  digest,
  normalizeSqlTables,
  stableJson,
} = require("./reverse-replay-postgres.cjs");

function artifactDigest(contents) {
  return nodeCrypto.createHash("sha256").update(contents).digest("hex");
}

function requireProductionRecovery({
  argumentsMap,
  environment,
  authorization,
  sourceSnapshot,
  sourceContents,
  targetSnapshot,
  targetContents,
  baselineSnapshot,
  baselineContents,
  rollbackCommit,
  rollbackConfiguration,
  rollbackBuild,
  environmentContents,
  databaseCa,
  reviewedPlan,
  reviewedPlanContents,
  plan,
  processEnvironment = process.env,
  now = Date.now(),
}) {
  const { scope, authorizedAt } = requireRecoveryScope(
    argumentsMap,
    environment,
    authorization,
    processEnvironment,
    now,
  );

  const database = authorization.database;
  const parsed = requireDatabaseTarget(argumentsMap, environment, database);
  const convex = authorization.convex;
  requireConvexTarget(argumentsMap, environment, convex);

  const sourceDigest = digest(normalizeSqlTables(sourceSnapshot.tables));
  if (
    sourceSnapshot.sourceKind !== "production" ||
    !isDigest(sourceSnapshot.inputDigest) ||
    authorization.sourceInputDigest !== sourceSnapshot.inputDigest ||
    authorization.sourceDigest !== sourceDigest ||
    authorization.sourceSnapshotDigest !== artifactDigest(sourceContents) ||
    authorization.targetExportDigest !== artifactDigest(targetContents) ||
    authorization.rollbackCommit !== rollbackCommit ||
    typeof rollbackConfiguration !== "string" ||
    !rollbackConfiguration.trim() ||
    authorization.configurationDigest !==
      artifactDigest(rollbackConfiguration) ||
    !Buffer.isBuffer(rollbackBuild) ||
    rollbackBuild.length === 0 ||
    authorization.rollbackBuildDigest !== artifactDigest(rollbackBuild) ||
    authorization.environmentDigest !== artifactDigest(environmentContents) ||
    !/^[a-f0-9]{40}$/.test(rollbackCommit)
  )
    throw new Error("Production recovery artifacts differ from operator scope");

  if (environment.ROLLBACK_DATABASE_CA_FILE) {
    if (
      !Buffer.isBuffer(databaseCa) ||
      authorization.databaseCaDigest !== artifactDigest(databaseCa)
    )
      throw new Error(
        "Production recovery database CA differs from operator scope",
      );

    const certificate = new nodeCrypto.X509Certificate(databaseCa);
    if (
      !certificate.ca ||
      Date.parse(certificate.validFrom) > now ||
      Date.parse(certificate.validTo) <= now
    )
      throw new Error(
        "Production recovery requires a current database CA certificate",
      );
  } else if (databaseCa !== undefined) {
    throw new Error(
      "Production recovery database CA has no explicit environment binding",
    );
  }

  requireProductionTarget(targetSnapshot, sourceSnapshot, convex);
  const exportedAt = requireTime(targetSnapshot.exportedAt);
  if (
    exportedAt > authorizedAt ||
    requireTime(sourceSnapshot.evaluationTime) > exportedAt
  )
    throw new Error("Production target export postdates operator scope");

  if (scope === "before-writes") {
    if (
      !baselineSnapshot ||
      authorization.targetBaselineDigest !== artifactDigest(baselineContents)
    )
      throw new Error("Production recovery baseline is not bound");

    requireProductionTarget(baselineSnapshot, sourceSnapshot, convex);
    if (
      requireTime(baselineSnapshot.exportedAt) > exportedAt ||
      requireTime(baselineSnapshot.exportedAt) <
        requireTime(sourceSnapshot.evaluationTime) ||
      stableJson(normalizeTargetTables(baselineSnapshot.tables)) !==
        stableJson(normalizeTargetTables(targetSnapshot.tables)) ||
      stableJson(baselineSnapshot.mappings) !==
        stableJson(targetSnapshot.mappings)
    )
      throw new Error(
        "Production recovery baseline changed or postdates current export",
      );
  } else {
    requireFrozenWriters(authorization, exportedAt, now);
    if (scope === "after-writes-apply") {
      const reviewedAt = requireTime(authorization.reviewedAt);
      if (
        !isText(authorization.reviewedBy) ||
        reviewedAt < exportedAt ||
        reviewedAt > authorizedAt ||
        !isDigest(authorization.replayDigest) ||
        !isDigest(authorization.reviewedPlanDigest) ||
        !reviewedPlanContents ||
        authorization.reviewedPlanDigest !==
          artifactDigest(reviewedPlanContents) ||
        stableJson(reviewedPlan) !== stableJson(plan) ||
        plan.replayDigest !== authorization.replayDigest
      )
        throw new Error(
          "Production replay requires the exact reviewed plan and replay digest",
        );
    }
  }

  if (
    !plan ||
    plan.sourceKind !== "production" ||
    plan.sourceDigest !== sourceDigest ||
    (scope === "before-writes" &&
      (plan.newCommittedBatches.length ||
        plan.sourceDigest !== plan.replayDigest))
  ) {
    throw new Error(
      "Production recovery plan differs from its authorized source",
    );
  }

  return {
    // Pin every connection field so ambient PG settings cannot retarget recovery.
    postgresOptions: {
      host: database.host,
      port: database.port,
      database: database.name,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      ssl: {
        rejectUnauthorized: true,
        ...(databaseCa ? { ca: databaseCa.toString("utf8") } : {}),
      },
      prepare: false,
      fetch_types: false,
      connect_timeout: 15,
      connection: {
        application_name: "investment-sync-production-recovery",
        search_path: "public",
        default_transaction_read_only:
          scope === "after-writes-apply" ? "off" : "on",
      },
    },
    databaseIdentity: {
      name: database.name,
      username: database.role,
      expiresAt: authorization.expiresAt,
    },
    receipt: {
      authorizationId: authorization.authorizationId,
      authorizedBy: authorization.authorizedBy,
      authorizedAt: authorization.authorizedAt,
      expiresAt: authorization.expiresAt,
      scope,
      database,
      convex,
      sourceSnapshotDigest: authorization.sourceSnapshotDigest,
      sourceInputDigest: authorization.sourceInputDigest,
      sourceDigest,
      targetExportDigest: authorization.targetExportDigest,
      environmentDigest: authorization.environmentDigest,
      ...(databaseCa
        ? { databaseCaDigest: authorization.databaseCaDigest }
        : {}),
      rollbackBuildDigest: authorization.rollbackBuildDigest,
      ...(scope === "after-writes-apply"
        ? {
            reviewedPlanDigest: authorization.reviewedPlanDigest,
            replayDigest: authorization.replayDigest,
            reviewedAt: authorization.reviewedAt,
            reviewedBy: authorization.reviewedBy,
          }
        : {}),
      ...(scope === "before-writes"
        ? { targetBaselineDigest: authorization.targetBaselineDigest }
        : {
            sourceReadOnly: authorization.sourceReadOnly,
            targetDrained: authorization.targetDrained,
          }),
    },
  };
}

function requireRecoveryScope(
  argumentsMap,
  environment,
  authorization,
  processEnvironment,
  now,
) {
  if (
    [...argumentsMap.values()].some((value) => typeof value !== "string") ||
    !["before-writes", "after-writes"].includes(argumentsMap.get("mode")) ||
    !["true", "false"].includes(argumentsMap.get("apply")) ||
    (argumentsMap.get("mode") === "before-writes" &&
      argumentsMap.get("apply") !== "false")
  )
    throw new Error(
      "Production recovery arguments do not identify a safe operation",
    );

  if (
    Object.keys(processEnvironment).some((key) => key.startsWith("PG")) ||
    Object.keys(environment).some(
      (key) =>
        ![
          "DATABASE_URL",
          "ROLLBACK_DATABASE_ENVIRONMENT",
          "ROLLBACK_CONVEX_DEPLOYMENT",
          "ROLLBACK_DATABASE_CA_FILE",
        ].includes(key),
    )
  )
    throw new Error(
      "Production recovery refuses ambient or explicit PG overrides",
    );

  const scope =
    argumentsMap.get("mode") === "before-writes"
      ? "before-writes"
      : argumentsMap.get("apply") === "true"
        ? "after-writes-apply"
        : "after-writes-plan";
  const authorizationFields = [
    "schemaVersion",
    "sourceKind",
    "scope",
    "authorizationId",
    "authorizedBy",
    "authorizedAt",
    "expiresAt",
    "database",
    "convex",
    "sourceInputDigest",
    "sourceDigest",
    "sourceSnapshotDigest",
    "targetExportDigest",
    "rollbackCommit",
    "configurationDigest",
    "rollbackBuildDigest",
    "environmentDigest",
    ...(environment.ROLLBACK_DATABASE_CA_FILE ? ["databaseCaDigest"] : []),
    ...(scope === "before-writes"
      ? ["targetBaselineDigest"]
      : ["sourceReadOnly", "targetDrained"]),
    ...(scope === "after-writes-apply"
      ? ["replayDigest", "reviewedPlanDigest", "reviewedAt", "reviewedBy"]
      : []),
  ];
  requireFields(authorization, authorizationFields, "operator scope");

  if (
    (scope !== "before-writes" && argumentsMap.has("target-baseline")) ||
    (scope !== "after-writes-apply" && argumentsMap.has("reviewed-plan"))
  )
    throw new Error(
      "Production recovery includes artifacts for a different operation",
    );

  if (
    argumentsMap.get("target") !== "production" ||
    environment.ROLLBACK_DATABASE_ENVIRONMENT !== "production" ||
    authorization?.schemaVersion !== 1 ||
    authorization.sourceKind !== "production" ||
    authorization.scope !== scope ||
    !isText(authorization.authorizationId) ||
    !isText(authorization.authorizedBy)
  )
    throw new Error("Production recovery requires its explicit operator scope");

  const authorizedAt = requireTime(authorization.authorizedAt);
  const expiresAt = requireTime(authorization.expiresAt);
  if (authorizedAt > now || expiresAt <= now || expiresAt <= authorizedAt)
    throw new Error("Production recovery operator scope is not current");

  return { scope, authorizedAt };
}

function requireDatabaseTarget(argumentsMap, environment, database) {
  requireFields(
    database,
    ["environment", "purpose", "host", "port", "name", "username", "role"],
    "database identity",
  );
  const parsed = new URL(environment.DATABASE_URL ?? "");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hash ||
    !parsed.username ||
    !parsed.password ||
    !isProductionHost(parsed.hostname) ||
    database.environment !== "production" ||
    !["retained-source", "isolated-recovery"].includes(database.purpose) ||
    !isText(database.username) ||
    !isText(database.role) ||
    database.username !== decodeURIComponent(parsed.username) ||
    database.host !== parsed.hostname ||
    database.port !== Number(parsed.port || 5432) ||
    !Number.isInteger(database.port) ||
    database.port < 1 ||
    database.port > 65535 ||
    !isText(database.name) ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(database.name) ||
    /(?:^|[_.-])(?:dev|development|test|testing|local|preview|rehearsal|synthetic)(?:$|[_.-])/i.test(
      database.name,
    ) ||
    parsed.pathname !== `/${database.name}` ||
    argumentsMap.get("expected-database-host") !== database.host ||
    argumentsMap.get("expected-database-name") !== database.name
  )
    throw new Error("Production recovery database identity is not pinned");

  const parameters = [...parsed.searchParams];
  if (
    parameters.length > 1 ||
    parameters.some(
      ([key, value]) =>
        key !== "sslmode" || !["require", "verify-full"].includes(value),
    )
  )
    throw new Error("Production recovery refuses database URL overrides");

  return parsed;
}

function requireConvexTarget(argumentsMap, environment, convex) {
  requireFields(
    convex,
    ["deployment", "url", "migrationRunKey"],
    "Convex identity",
  );
  if (
    typeof convex.deployment !== "string" ||
    !/^prod:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(convex.deployment) ||
    convex.url !== `https://${convex.deployment.slice(5)}.convex.cloud` ||
    !isText(convex.migrationRunKey) ||
    argumentsMap.get("expected-convex-deployment") !== convex.deployment ||
    environment.ROLLBACK_CONVEX_DEPLOYMENT !== convex.deployment
  )
    throw new Error("Production recovery requires its named Convex deployment");
}

function requireProductionTarget(target, source, convex) {
  normalizeTargetTables(target?.tables);
  const runs = target.tables.migrationRuns;
  const matchingRuns = Array.isArray(runs)
    ? runs.filter((run) => run.runKey === convex.migrationRunKey)
    : [];
  const run = matchingRuns[0];
  if (
    target?.schemaVersion !== 1 ||
    target.projectorVersion !== "portfolio-v1" ||
    target.sourceKind !== "production" ||
    target.inputDigest !== source.inputDigest ||
    target.evaluationTime !== source.evaluationTime ||
    target.deployment !== convex.deployment ||
    target.url !== convex.url ||
    matchingRuns.length !== 1 ||
    run.sourceKind !== "production" ||
    run.inputDigest !== source.inputDigest ||
    run.evaluationTime !== source.evaluationTime ||
    run.inputSealed !== true
  )
    throw new Error(
      "Production target does not identify the sealed source run",
    );
}

function requireFrozenWriters(authorization, exportedAt, now) {
  const source = authorization.sourceReadOnly;
  const target = authorization.targetDrained;
  if (
    source?.writersDisabled !== true ||
    !isText(source.evidenceReference) ||
    target?.writersDisabled !== true ||
    target.activeParses !== 0 ||
    target.activePublications !== 0 ||
    target.pendingJobs !== 0 ||
    !isText(target.evidenceReference)
  )
    throw new Error("Production after-write recovery requires frozen writers");

  requireFields(
    source,
    ["writersDisabled", "evidenceReference", "confirmedAt", "validUntil"],
    "source writer evidence",
  );
  requireFields(
    target,
    [
      "writersDisabled",
      "activeParses",
      "activePublications",
      "pendingJobs",
      "evidenceReference",
      "confirmedAt",
      "validUntil",
    ],
    "target writer evidence",
  );

  for (const evidence of [source, target]) {
    const confirmedAt = requireTime(evidence.confirmedAt);
    const validUntil = requireTime(evidence.validUntil);
    if (
      confirmedAt > exportedAt ||
      confirmedAt > requireTime(authorization.authorizedAt) ||
      validUntil <= now ||
      validUntil < requireTime(authorization.expiresAt)
    )
      throw new Error("Production writer evidence does not cover recovery");
  }
}

function isProductionHost(host) {
  return (
    !net.isIP(host) &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(host) &&
    !/(?:^|[.-])(?:localhost|local|internal|invalid|test|dev|development|preview|rehearsal|synthetic)(?:$|[.-])/i.test(
      host,
    )
  );
}

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function requireTime(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString().slice(0, 19) !==
      value.slice(0, 19)
  )
    throw new Error("Production recovery requires explicit UTC evidence times");

  return Date.parse(value);
}

function requireFields(value, fields, description) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    throw new Error(`Production recovery has malformed ${description}`);
}

function normalizeTargetTables(tables) {
  const expectedTables = [
    ...TARGET_TABLES,
    "importDedupeKeys",
    "portfolioPositions",
    "portfolioHistoryFacts",
    "portfolioHistoryScopes",
    "portfolioSummaries",
    "assetClassSummaries",
    "portfolioTimeline",
    "legacyHoldingAliases",
    "migrationRuns",
    "migrationRecords",
    "migrationMappings",
  ];
  if (!tables || typeof tables !== "object" || Array.isArray(tables))
    throw new Error("Production recovery has malformed target tables");

  if (Object.keys(tables).sort().join() !== expectedTables.sort().join())
    throw new Error("Production recovery requires a complete target export");

  return Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => {
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            !isText(row._id),
        ) ||
        new Set(rows.map((row) => row._id)).size !== rows.length
      )
        throw new Error("Production recovery has malformed target rows");

      return [
        table,
        [...rows].sort((left, right) => left._id.localeCompare(right._id)),
      ];
    }),
  );
}

module.exports = { artifactDigest, requireProductionRecovery };
