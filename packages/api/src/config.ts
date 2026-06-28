import { z } from "zod";
export {
  ALLOWED_IMPORT_EXTENSIONS,
  ALLOWED_IMPORT_MIME_TYPES,
  MAX_IMPORT_FILE_SIZE_BYTES,
  validateImportFile,
} from "@investment-sync/importers";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  DATABASE_URL: optionalString,
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_IMPORT_BUCKET: z.string().min(1).default("portfolio-imports"),
  CRON_SECRET: optionalString,
  NEXT_PUBLIC_APP_URL: optionalUrl,
  EXPO_PUBLIC_API_URL: optionalUrl,
});

const dataConfiguredSchema = envSchema.pick({
  DATABASE_URL: true,
  SUPABASE_URL: true,
  SUPABASE_SERVICE_ROLE_KEY: true,
});

export type AppEnv = z.infer<typeof envSchema>;

export function getAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(env);
}

export function isDataConfigured(env: NodeJS.ProcessEnv = process.env) {
  const parsed = dataConfiguredSchema.safeParse(env);
  if (!parsed.success) return false;
  return Boolean(
    parsed.data.DATABASE_URL &&
    parsed.data.SUPABASE_URL &&
    parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getImportBucketName() {
  return getAppEnv().SUPABASE_IMPORT_BUCKET;
}
