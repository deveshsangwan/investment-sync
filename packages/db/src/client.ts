import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

type GlobalDatabaseCache = {
  databaseUrl?: string;
  db?: Database;
  supabase?: SupabaseClient;
};

const globalDatabaseCache = globalThis as typeof globalThis & {
  __investmentSyncDb?: GlobalDatabaseCache;
};

export function createDatabase(
  databaseUrl = process.env.DATABASE_URL,
): Database {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (
    databaseUrl === process.env.DATABASE_URL &&
    globalDatabaseCache.__investmentSyncDb?.databaseUrl === databaseUrl &&
    globalDatabaseCache.__investmentSyncDb.db
  ) {
    return globalDatabaseCache.__investmentSyncDb.db;
  }

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

  const db = drizzle(client, { schema });

  if (databaseUrl === process.env.DATABASE_URL) {
    globalDatabaseCache.__investmentSyncDb = {
      ...globalDatabaseCache.__investmentSyncDb,
      databaseUrl,
      db,
    };
  }

  return db;
}

export function createSupabaseAdmin(): SupabaseClient {
  if (globalDatabaseCache.__investmentSyncDb?.supabase) {
    return globalDatabaseCache.__investmentSyncDb.supabase;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  globalDatabaseCache.__investmentSyncDb = {
    ...globalDatabaseCache.__investmentSyncDb,
    supabase,
  };

  return supabase;
}
