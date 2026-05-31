import { DashboardClient } from "./dashboard-client";

export default function DashboardPage() {
  const isDataConfigured = Boolean(
    process.env.DATABASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return <DashboardClient isDataConfigured={isDataConfigured} />;
}
