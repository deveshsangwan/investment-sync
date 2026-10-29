import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexAppProvider } from "../../src/app/convex-provider";
import { DashboardClient } from "../../src/app/dashboard/dashboard-client";
import { UploadsRoute } from "../../src/app/uploads/uploads-client";
import { TestIdentityProvider } from "./auth";
import Link, { usePathname } from "./navigation";

function App() {
  const pathname = usePathname();

  return (
    <TestIdentityProvider>
      <ConvexAppProvider>
        <nav aria-label="Portfolio pages">
          <Link href="/uploads">Imports</Link>{" "}
          <Link href="/dashboard">Dashboard</Link>
        </nav>
        {pathname === "/dashboard" ? <DashboardClient /> : <UploadsRoute />}
      </ConvexAppProvider>
    </TestIdentityProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing browser test root");

createRoot(root).render(<App />);
