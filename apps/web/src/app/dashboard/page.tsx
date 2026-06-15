import { isDataConfigured } from "@investment-sync/api";
import { DashboardClient } from "./dashboard-client";

export default function DashboardPage() {
  return <DashboardClient isDataConfigured={isDataConfigured()} />;
}
