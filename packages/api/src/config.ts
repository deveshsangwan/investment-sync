import { z } from "zod";

export const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_IMPORT_EXTENSIONS = [".csv", ".xlsx"] as const;
export const ALLOWED_IMPORT_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

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

export function validateImportFile(input: {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}) {
  if (input.sizeBytes > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new Error("Import files must be 50 MB or smaller");
  }

  const lowerName = input.fileName.toLowerCase();
  const hasAllowedExtension = ALLOWED_IMPORT_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );
  if (!hasAllowedExtension) {
    throw new Error("Import files must be CSV or XLSX files");
  }

  if (
    input.mimeType &&
    !ALLOWED_IMPORT_MIME_TYPES.includes(
      input.mimeType as (typeof ALLOWED_IMPORT_MIME_TYPES)[number],
    )
  ) {
    throw new Error("Import file type is not supported");
  }
}
