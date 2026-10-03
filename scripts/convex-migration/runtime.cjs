const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_ROOT = path.resolve(process.cwd(), ".migration");

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;

    if (!argument?.startsWith("--")) fail("Arguments must use --name value");

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${argument}`);

    const name = argument.slice(2);
    if (values.has(name)) fail(`Duplicate argument: --${name}`);
    values.set(name, value);
    index += 1;
  }

  return values;
}

function assertAllowedArguments(argumentsMap, allowed) {
  for (const name of argumentsMap.keys()) {
    if (!allowed.includes(name)) fail(`Unknown argument: --${name}`);
  }
}

function requireProductionArguments(argumentsMap) {
  if (argumentsMap.get("target") !== "production") {
    fail("Refusing inventory without --target production");
  }

  const envFile = argumentsMap.get("env-file");
  if (!envFile) fail("Refusing implicit environment lookup; pass --env-file");

  const runId = argumentsMap.get("run-id");
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
    fail("Pass a filesystem-safe --run-id of at most 80 characters");
  }

  return { envFile: path.resolve(envFile), runId };
}

function loadExplicitEnvironment(envFile) {
  const environment = {};
  let contents;
  try {
    contents = fs.readFileSync(envFile, "utf8");
  } catch {
    fail("Explicit environment file could not be read");
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) fail("Invalid environment file line");

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    environment[key] = stripQuotes(rawValue);
  }

  return environment;
}

function assertProductionDatabaseUrl(databaseUrl) {
  if (!databaseUrl) fail("Explicit environment file lacks DATABASE_URL");

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is not a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("DATABASE_URL must use PostgreSQL");
  }

  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    fail("Production inventory refuses a local database URL");
  }

  return parsed;
}

function assertProductionStorageUrl(storageUrl) {
  const parsed = new URL(storageUrl);

  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    fail("Production storage inventory refuses a local Supabase URL");
  }

  return parsed;
}

function sourceFingerprint(parts) {
  return nodeCrypto
    .createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function createProtectedRunDirectory(runId) {
  refuseSymlink(MIGRATION_ROOT);
  fs.mkdirSync(MIGRATION_ROOT, { mode: 0o700, recursive: true });
  fs.chmodSync(MIGRATION_ROOT, 0o700);
  const runDirectory = path.join(MIGRATION_ROOT, runId);
  refuseSymlink(runDirectory);
  fs.mkdirSync(runDirectory, { mode: 0o700, recursive: true });
  fs.chmodSync(runDirectory, 0o700);
  return runDirectory;
}

function writeProtectedJson(runDirectory, fileName, value) {
  const target = path.resolve(runDirectory, fileName);
  if (!target.startsWith(`${MIGRATION_ROOT}${path.sep}`)) {
    fail("Inventory artifacts must stay under .migration");
  }

  const temporary = `${target}.tmp`;
  if (fs.existsSync(target) || fs.existsSync(temporary)) {
    fail("Refusing to overwrite an inventory artifact");
  }
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

function refuseSymlink(target) {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      fail("Refusing a symlinked migration artifact directory");
    }
  } catch (error) {
    if (error?.code !== "ENOENT")
      fail("Migration artifact directory is unsafe");
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

module.exports = {
  createProtectedRunDirectory,
  assertAllowedArguments,
  fail,
  loadExplicitEnvironment,
  parseArguments,
  requireProductionArguments,
  assertProductionDatabaseUrl,
  assertProductionStorageUrl,
  sourceFingerprint,
  writeProtectedJson,
};
