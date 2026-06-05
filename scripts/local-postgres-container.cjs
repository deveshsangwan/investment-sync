const { spawnSync } = require("node:child_process");

const CONTAINER_NAME = "investment-sync-postgres";
const VOLUME_NAME = "investment-sync-postgres";
const IMAGE = "postgres:16-alpine";
// Apple container volumes include lost+found at the mount root; Postgres must use a subdirectory.
const PGDATA = "/var/lib/postgresql/mount/data";
const PGDATA_ENV = `PGDATA=${PGDATA}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function container(args, options) {
  return run("container", args, options);
}

function exists() {
  const result = container(["inspect", CONTAINER_NAME], {
    quiet: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    return false;
  }
  const output = (result.stdout || "").trim();
  // Apple's container CLI returns exit 0 with "[]" when the name is missing.
  return output.length > 0 && output !== "[]";
}

function isRunning() {
  const result = container(["list", "-a", "--format", "json"], {
    quiet: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    return false;
  }
  try {
    const rows = JSON.parse(result.stdout || "[]");
    const row = rows.find(
      (entry) => entry.configuration?.id === CONTAINER_NAME,
    );
    return row?.status === "running";
  } catch {
    return false;
  }
}

function failIfNotRunning() {
  if (isRunning()) {
    return;
  }
  console.error(`Postgres container is not running: ${CONTAINER_NAME}`);
  console.error("Recent logs:");
  container(["logs", CONTAINER_NAME], { allowFailure: true });
  console.error(`Try: pnpm db:container:down && pnpm db:container:up`);
  process.exit(1);
}

function up() {
  container(["system", "start"]);

  container(["volume", "create", VOLUME_NAME], {
    quiet: true,
    allowFailure: true,
  });

  if (exists()) {
    container(["start", CONTAINER_NAME]);
    failIfNotRunning();
    console.log(`Postgres container started: ${CONTAINER_NAME}`);
    return;
  }

  container([
    "run",
    "--detach",
    "--name",
    CONTAINER_NAME,
    "--publish",
    "54329:5432",
    "--env",
    "POSTGRES_USER=investment_sync",
    "--env",
    "POSTGRES_PASSWORD=investment_sync",
    "--env",
    "POSTGRES_DB=investment_sync_dev",
    "--env",
    PGDATA_ENV,
    "--volume",
    `${VOLUME_NAME}:/var/lib/postgresql/mount`,
    IMAGE,
  ]);

  failIfNotRunning();

  console.log(
    "DATABASE_URL=postgresql://investment_sync:investment_sync@localhost:54329/investment_sync_dev",
  );
}

function down() {
  container(["stop", CONTAINER_NAME], { allowFailure: true });
  container(["rm", CONTAINER_NAME], { allowFailure: true });
}

function logs() {
  container(["logs", CONTAINER_NAME]);
}

const command = process.argv[2];

if (command === "up") {
  up();
} else if (command === "down") {
  down();
} else if (command === "logs") {
  logs();
} else {
  console.error(
    "Usage: node scripts/local-postgres-container.cjs <up|down|logs>",
  );
  process.exit(1);
}
