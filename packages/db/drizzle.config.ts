import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), "../../apps/web/.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const databaseUrl = stripQuotes(process.env.DATABASE_URL ?? "");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1).trim());
    process.env[key] ??= value;
  }
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "");
}
