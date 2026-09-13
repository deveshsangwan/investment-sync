"use client";

import { useAuth } from "@clerk/nextjs";
import { api } from "@investment-sync/backend/api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { usePathname } from "next/navigation";
import { ErrorState, PageShell } from "@/components/portfolio-ui";
import { HoldingsNavigationProvider } from "@/components/holdings-navigation";
import { QueryCacheProvider } from "./query-cache-provider";

type ConvexSessionStatus =
  | "auth-loading"
  | "auth-error"
  | "signed-out"
  | "provisioning"
  | "ready"
  | "error";
type ProvisioningStatus = "provisioning" | "ready" | "error";

interface ConvexSessionValue {
  status: ConvexSessionStatus;
  retryAuthentication: () => void;
  retryProvisioning: () => void;
}

interface ConvexSessionGateProps {
  children: ReactNode;
  errorHeader?: ReactNode;
  loading: ReactNode;
}

const ConvexSessionContext = createContext<ConvexSessionValue | null>(null);
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function useConvexSession() {
  const session = useContext(ConvexSessionContext);
  if (!session) throw new Error("Convex session provider is missing");
  return session;
}

export function ConvexSessionGate({
  children,
  errorHeader,
  loading,
}: ConvexSessionGateProps) {
  const { status, retryAuthentication, retryProvisioning } = useConvexSession();

  if (status === "auth-error") {
    return (
      <>
        {errorHeader}
        <ErrorState
          title="Your secure connection could not be restored"
          description="Try connecting your account again. Your saved portfolio and imports have not changed."
          onRetry={retryAuthentication}
        />
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        {errorHeader}
        <ErrorState
          title="Your account could not be prepared"
          description="Try preparing your account again. Your saved portfolio and imports have not changed."
          onRetry={retryProvisioning}
        />
      </>
    );
  }

  return status === "ready" ? children : loading;
}

export function ConvexAppProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, sessionId, userId } = useAuth();

  if (!convexClient) {
    if (isPublicPath(pathname)) return children;

    return (
      <PageShell className="grid min-h-[70dvh] place-items-center">
        <div className="w-full max-w-2xl">
          <ErrorState
            title="Portfolio service is not configured"
            description="The portfolio service is unavailable in this environment. Try again after it has been configured."
            onRetry={() => window.location.reload()}
          />
        </div>
      </PageShell>
    );
  }

  const identityKey = isLoaded
    ? `${userId ?? "signed-out"}:${sessionId ?? "no-session"}`
    : "loading";

  return (
    <RecoverableConvexProvider key={identityKey} client={convexClient}>
      {children}
    </RecoverableConvexProvider>
  );
}

function RecoverableConvexProvider({
  children,
  client,
}: {
  children: ReactNode;
  client: ConvexReactClient;
}) {
  const [generation, setGeneration] = useState(0);
  const activeGeneration = useRef(0);
  const failedGeneration = useRef<number | null>(null);
  const hasReconnectRecovery = useRef(false);

  const remountAuthentication = useCallback((expectedGeneration: number) => {
    if (activeGeneration.current !== expectedGeneration) return;

    const nextGeneration = expectedGeneration + 1;
    activeGeneration.current = nextGeneration;
    failedGeneration.current = null;
    hasReconnectRecovery.current = false;
    setGeneration(nextGeneration);
  }, []);

  useEffect(() => {
    const recoverAfterReconnect = () => {
      hasReconnectRecovery.current = true;

      const currentGeneration = activeGeneration.current;
      if (failedGeneration.current === currentGeneration) {
        remountAuthentication(currentGeneration);
      }
    };

    window.addEventListener("online", recoverAfterReconnect);
    return () => window.removeEventListener("online", recoverAfterReconnect);
  }, [remountAuthentication]);

  const reportAuthenticationFailure = useCallback(() => {
    if (activeGeneration.current !== generation) return;

    if (hasReconnectRecovery.current) {
      remountAuthentication(generation);
      return;
    }

    failedGeneration.current = generation;
  }, [generation, remountAuthentication]);

  const retryAuthentication = useCallback(() => {
    remountAuthentication(generation);
  }, [generation, remountAuthentication]);

  return (
    <ConvexProviderWithClerk key={generation} client={client} useAuth={useAuth}>
      <ProvisionAuthenticatedUser
        onAuthenticationFailure={reportAuthenticationFailure}
        retryAuthentication={retryAuthentication}
      >
        {children}
      </ProvisionAuthenticatedUser>
    </ConvexProviderWithClerk>
  );
}

function ProvisionAuthenticatedUser({
  children,
  onAuthenticationFailure,
  retryAuthentication,
}: {
  children: ReactNode;
  onAuthenticationFailure: () => void;
  retryAuthentication: () => void;
}) {
  const { isLoaded, userId } = useAuth();

  return (
    <ProvisionCurrentUser
      key={isLoaded ? (userId ?? "signed-out") : "loading"}
      onAuthenticationFailure={onAuthenticationFailure}
      retryAuthentication={retryAuthentication}
    >
      {children}
    </ProvisionCurrentUser>
  );
}

function ProvisionCurrentUser({
  children,
  onAuthenticationFailure,
  retryAuthentication,
}: {
  children: ReactNode;
  onAuthenticationFailure: () => void;
  retryAuthentication: () => void;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensureCurrentUser = useMutation(api.users.ensureCurrent);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ProvisioningStatus>("provisioning");
  const clerkIsAuthenticated = isLoaded && isSignedIn === true;
  const hasAuthenticationFailure =
    clerkIsAuthenticated && !isLoading && !isAuthenticated;

  useEffect(() => {
    if (hasAuthenticationFailure) onAuthenticationFailure();
  }, [hasAuthenticationFailure, onAuthenticationFailure]);

  useEffect(() => {
    let active = true;

    if (!clerkIsAuthenticated || isLoading || !isAuthenticated) {
      return () => {
        active = false;
      };
    }

    void ensureCurrentUser()
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [
    attempt,
    clerkIsAuthenticated,
    ensureCurrentUser,
    isAuthenticated,
    isLoading,
  ]);

  const retryProvisioning = useCallback(() => {
    setStatus("provisioning");
    setAttempt((current) => current + 1);
  }, []);
  const exposedStatus: ConvexSessionStatus =
    !isLoaded || isLoading
      ? "auth-loading"
      : !clerkIsAuthenticated
        ? "signed-out"
        : !isAuthenticated
          ? "auth-error"
          : status;
  const value = useMemo(
    () => ({ status: exposedStatus, retryAuthentication, retryProvisioning }),
    [exposedStatus, retryAuthentication, retryProvisioning],
  );

  return (
    <ConvexSessionContext.Provider value={value}>
      <QueryCacheProvider enabled={exposedStatus === "ready"}>
        <HoldingsNavigationProvider
          key={exposedStatus === "ready" ? "ready" : "unavailable"}
        >
          {children}
        </HoldingsNavigationProvider>
      </QueryCacheProvider>
    </ConvexSessionContext.Provider>
  );
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname === "/privacy" ||
    pathname === "/terms"
  );
}
