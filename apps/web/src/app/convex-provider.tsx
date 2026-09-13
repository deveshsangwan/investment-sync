"use client";

import { useAuth } from "@clerk/nextjs";
import { api } from "@investment-sync/backend/api";
import { useEffect, useState } from "react";
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
  const [provisioned, setProvisioned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!isAuthenticated) return;

    void ensureCurrentUser()
      .then(() => {
        if (active) {
          setProvisioned(true);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Account setup failed",
          );
      });
    return () => {
      active = false;
    };
  }, [ensureCurrentUser, isAuthenticated]);

  if (
    process.env.NEXT_PUBLIC_CONVEX_IMPORTS_ENABLED === "true" &&
    isAuthenticated &&
    !provisioned
  ) {
    return (
      <div role={error ? "alert" : "status"} className="p-8">
        {error ?? "Preparing your account…"}
        {error ? (
          <button
            className="ml-3 underline"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return children;
}

function ProvisionAuthenticatedUser({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = useAuth();

  return <ProvisionCurrentUser key={userId}>{children}</ProvisionCurrentUser>;
}

export function DevelopmentConvexProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!convexClient) return children;

  return (
    <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
      <ProvisionAuthenticatedUser>{children}</ProvisionAuthenticatedUser>
    </ConvexProviderWithClerk>
  );
}
