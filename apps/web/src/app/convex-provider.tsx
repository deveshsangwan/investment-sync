"use client";

import { useAuth } from "@clerk/nextjs";
import { api } from "@investment-sync/backend/api";
import { useEffect } from "react";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient =
  process.env.NODE_ENV === "development" && convexUrl
    ? new ConvexReactClient(convexUrl)
    : null;

function ProvisionCurrentUser({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const ensureCurrentUser = useMutation(api.users.ensureCurrent);

  useEffect(() => {
    if (!isAuthenticated) return;

    void ensureCurrentUser().catch((error: unknown) => {
      console.error("Failed to provision the development Convex user", error);
    });
  }, [ensureCurrentUser, isAuthenticated]);

  return children;
}

export function DevelopmentConvexProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!convexClient) return children;

  return (
    <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
      <ProvisionCurrentUser>{children}</ProvisionCurrentUser>
    </ConvexProviderWithClerk>
  );
}
