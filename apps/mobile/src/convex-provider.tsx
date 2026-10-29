import { useAuth } from "@clerk/clerk-expo";
import { api } from "@investment-sync/backend/api";
import {
  ConvexReactClient,
  useConvexAuth,
  useConvexConnectionState,
  useMutation,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton, StatePanel } from "./mobile-ui";
import { SignInScreen } from "./sign-in-screen";
import { useTheme } from "./theme";

export function MobilePortfolioProvider({
  children,
  convexUrl,
}: {
  children: ReactNode;
  convexUrl: string;
}) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();

  if (!isLoaded) {
    return <SessionPanel title="Loading your session" />;
  }

  if (!isSignedIn || !userId || !sessionId) {
    return <SignInScreen />;
  }

  // A new Clerk session gets a new client and cache, even for the same user.
  return (
    <RecoverableSession
      key={`${convexUrl}:${userId}:${sessionId}`}
      convexUrl={convexUrl}
    >
      {children}
    </RecoverableSession>
  );
}

function RecoverableSession({
  children,
  convexUrl,
}: {
  children: ReactNode;
  convexUrl: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((current) => current + 1);

  return (
    <PortfolioQueryBoundary key={attempt} onRetry={retry}>
      <SessionConnection convexUrl={convexUrl} onRetry={retry}>
        {children}
      </SessionConnection>
    </PortfolioQueryBoundary>
  );
}

function SessionConnection({
  children,
  convexUrl,
  onRetry,
}: {
  children: ReactNode;
  convexUrl: string;
  onRetry: () => void;
}) {
  const [client] = useState(
    () =>
      new ConvexReactClient(convexUrl, {
        unsavedChangesWarning: false,
      }),
  );
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;

      // Strict Mode replays effects without replacing the lazy client. Let
      // that setup finish before disposing a genuinely unmounted session.
      queueMicrotask(() => {
        if (!isMounted.current) void client.close();
      });
    };
  }, [client]);

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      <AuthenticatedSession onRetry={onRetry}>{children}</AuthenticatedSession>
    </ConvexProviderWithClerk>
  );
}

function AuthenticatedSession({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const hasAuthenticationError = !isLoading && !isAuthenticated;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && hasAuthenticationError) onRetry();
    });

    return () => subscription.remove();
  }, [hasAuthenticationError, onRetry]);

  if (isLoading) {
    return <SessionPanel title="Connecting securely" onRetry={onRetry} />;
  }

  if (!isAuthenticated) {
    return (
      <SessionPanel
        title="Could not connect your account"
        isError
        onRetry={onRetry}
      />
    );
  }

  return <ProvisionedSession onRetry={onRetry}>{children}</ProvisionedSession>;
}

function ProvisionedSession({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry: () => void;
}) {
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;

    void ensureCurrent().then(
      () => {
        if (active) setStatus("ready");
      },
      () => {
        if (active) setStatus("error");
      },
    );

    return () => {
      active = false;
    };
  }, [ensureCurrent]);

  if (status !== "ready") {
    return (
      <SessionPanel
        title={
          status === "error"
            ? "Could not prepare your account"
            : "Preparing your account"
        }
        isError={status === "error"}
        onRetry={onRetry}
      />
    );
  }

  return (
    <View style={styles.app}>
      <ConnectionStatus onRetry={onRetry} />
      {children}
    </View>
  );
}

function ConnectionStatus({ onRetry }: { onRetry: () => void }) {
  const { isWebSocketConnected } = useConvexConnectionState();
  const theme = useTheme();
  const { signOut } = useAuth();

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ backgroundColor: theme.background }}
    >
      <View style={styles.toolbar}>
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.mutedForeground, flex: 1 }}
        >
          {isWebSocketConnected
            ? "Live portfolio"
            : "Reconnecting · values may be out of date"}
        </Text>
        {!isWebSocketConnected ? (
          <AppButton
            label="Reconnect to portfolio"
            onPress={onRetry}
            variant="secondary"
          >
            Retry
          </AppButton>
        ) : null}
        <AppButton
          label="Sign out"
          onPress={() => void signOut()}
          variant="secondary"
        >
          Sign out
        </AppButton>
      </View>
    </SafeAreaView>
  );
}

function SessionPanel({
  title,
  isError = false,
  onRetry,
}: {
  title: string;
  isError?: boolean;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const { signOut, isSignedIn } = useAuth();

  return (
    <SafeAreaView style={[styles.panel, { backgroundColor: theme.background }]}>
      <StatePanel
        title={title}
        tone={isError ? "error" : "neutral"}
        description={
          isError
            ? "Your saved portfolio has not changed. Check your connection and try again."
            : "Waiting for a secure connection to your portfolio."
        }
        action={
          onRetry ? (
            <AppButton
              label="Try connecting again"
              onPress={onRetry}
              variant="secondary"
            >
              Try again
            </AppButton>
          ) : undefined
        }
      />
      {isSignedIn ? (
        <AppButton
          label="Sign out"
          onPress={() => void signOut()}
          variant="secondary"
        >
          Sign out
        </AppButton>
      ) : null}
    </SafeAreaView>
  );
}

class PortfolioQueryBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <SessionPanel
          title="Portfolio unavailable"
          isError
          onRetry={this.props.onRetry}
        />
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  panel: { flex: 1, justifyContent: "center", padding: 18, gap: 14 },
});
