import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

  return drizzle(client, { schema });
}

export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
