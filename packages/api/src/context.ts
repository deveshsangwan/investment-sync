import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@investment-sync/db";
import { createDatabase, createSupabaseAdmin } from "@investment-sync/db";

export interface SessionAuth {
  userId: string | null;
  email?: string | null;
}

export interface CreateContextOptions {
  auth: SessionAuth;
  db?: Database;
  supabase?: SupabaseClient;
}

export interface ApiContext {
  auth: SessionAuth;
  db: Database;
  supabase: SupabaseClient;
  cache: Map<string, Promise<unknown>>;
}

export function createApiContext(options: CreateContextOptions): ApiContext {
  return {
    auth: options.auth,
    db: options.db ?? createDatabase(),
    supabase: options.supabase ?? createSupabaseAdmin(),
    cache: new Map(),
  };
}
