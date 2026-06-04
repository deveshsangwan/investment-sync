import { UploadsClient } from "./uploads-client";

export default function UploadsPage() {
  const isDataConfigured = Boolean(
    process.env.DATABASE_URL &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return <UploadsClient isDataConfigured={isDataConfigured} />;
}
import { UploadsClient } from "./uploads-client";

export default function UploadsPage() {
  return <UploadsClient />;
}
