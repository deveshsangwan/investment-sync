import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = resolve(web, "../../packages/backend");
const binary = process.env.E2E_CONVEX_BINARY;

if (!binary)
  throw new Error(
    "Set E2E_CONVEX_BINARY to the pinned local Convex binary. See docs/ui-testing.md.",
  );

const binaryHash = createHash("sha256")
  .update(await readFile(binary))
  .digest("hex");

if (
  binaryHash !==
  "36c41a7fc2deb8aff06ee6701493767f441c9fe4ec0fc27be59229c6af29027f"
) {
  throw new Error(
    "Unexpected local backend binary; use the pinned Linux x64 release in docs/ui-testing.md",
  );
}

const workspace = await mkdtemp(resolve(tmpdir(), "investment-sync-e2e-"));
const children = [];
let issuerServer;
let cleanupPromise;
function cleanup() {
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = (async () => {
    issuerServer?.close();
    for (const { child } of children.toReversed()) child.kill("SIGTERM");

    await Promise.all(children.map(({ closed }) => closed));
    await rm(workspace, { recursive: true, force: true });
  })();

  return cleanupPromise;
}

function trackChild(child) {
  // Register before exit or spawn failure so cleanup can also join children
  // that have already ended, including those terminated by a signal.
  const closed = new Promise((done) => child.once("close", done));
  children.push({ child, closed });

  return child;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void cleanup().then(() => process.exit(0)));
}

// Whitelist environment values. Never read a user's backend selection or keys.
const environment = {
  PATH: process.env.PATH,
  HOME: workspace,
  TMPDIR: workspace,
  CONVEX_DISABLE_TELEMETRY: "1",
};
function launch(command, args, cwd, extraEnvironment = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...environment, ...extraEnvironment },
    stdio: ["ignore", "inherit", "inherit"],
  });
  trackChild(child);
  child.on("error", (error) => {
    console.error(error);
    void cleanup().then(() => process.exit(1));
  });
  return child;
}
async function runCli(args, adminKey) {
  const child = spawn(
    process.execPath,
    [
      resolve(backend, "node_modules/convex/bin/main.js"),
      ...args,
      "--url",
      "http://127.0.0.1:3218",
      "--admin-key",
      adminKey,
    ],
    { cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  trackChild(child);
  let output = "";
  child.stderr.on("data", (data) => {
    output += data.toString();
  });
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error(output)),
    );
  });
}
async function waitForBackend(child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Local backend exited during startup");

    try {
      const response = await fetch("http://127.0.0.1:3218/version");

      if (response.ok) return;
    } catch {
      /* The local process has not bound its port yet. */
    }

    await new Promise((done) => setTimeout(done, 200));
  }

  throw new Error("Local backend startup timed out");
}

try {
  await cp(resolve(backend, "convex"), resolve(workspace, "convex"), {
    recursive: true,
  });
  await cp(resolve(backend, "src"), resolve(workspace, "src"), {
    recursive: true,
  });
  await cp(
    resolve(backend, "src/testing/browserSeed.ts"),
    resolve(workspace, "convex/testing/browserSeed.ts"),
  );
  await writeFile(
    resolve(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
    }),
  );
  await symlink(
    resolve(backend, "node_modules"),
    resolve(workspace, "node_modules"),
    "dir",
  );
  await writeFile(
    resolve(workspace, "package.json"),
    JSON.stringify({ type: "module", dependencies: { convex: "1.45.0" } }),
  );

  const issuer = "http://127.0.0.1:3220";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "local-e2e",
    use: "sig",
    alg: "RS256",
  };
  issuerServer = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
    const subject = request.url?.replace("/token/", "");
    if (request.url === "/.well-known/openid-configuration") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ issuer, jwks_uri: `${issuer}/.well-known/jwks.json` }),
      );
    } else if (request.url === "/.well-known/jwks.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ keys: [jwk] }));
    } else if (
      ["e2e_owner", "e2e_viewer", "e2e_other", "e2e_sales"].includes(subject)
    ) {
      void new SignJWT({
        email: `${subject}@example.invalid`,
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience("convex")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey)
        .then((token) => response.end(token));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((ready, reject) => {
    issuerServer.once("error", reject);
    issuerServer.listen(3220, "127.0.0.1", ready);
  });

  const instanceName = "investment-sync-e2e";
  const instanceSecret = randomBytes(32).toString("hex");
  const adminKey = execFileSync(
    binary,
    [
      "keygen",
      "admin-key",
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
    ],
    { encoding: "utf8" },
  ).trim();
  const child = launch(
    binary,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      "3218",
      "--site-proxy-port",
      "3219",
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
      "--disable-beacon",
    ],
    workspace,
    { RUST_LOG: "warn", TZ: "UTC" },
  );
  await waitForBackend(child);
  await runCli(["env", "set", "CLERK_JWT_ISSUER_DOMAIN", issuer], adminKey);
  await runCli(["env", "set", "APP_ENV", "test"], adminKey);
  // Load application code ONLY into the fresh loopback backend, never a selected deployment.
  await runCli(
    ["dev", "--once", "--typecheck", "disable", "--codegen", "disable"],
    adminKey,
  );
  await runCli(["run", "testing/browserSeed:seed", "{}"], adminKey);
  const vite = launch(
    process.execPath,
    [
      resolve(web, "node_modules/vite/bin/vite.js"),
      "--config",
      "e2e/vite.config.ts",
    ],
    web,
  );
  vite.once(
    "exit",
    (code) => void cleanup().then(() => process.exit(code ?? 1)),
  );
} catch (error) {
  // CLI stderr contains diagnostics, but never print its argv or generated key.
  console.error(error.stderr?.toString() ?? error.message);
  await cleanup();
  process.exit(1);
}
