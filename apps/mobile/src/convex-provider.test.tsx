import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { MobilePortfolioProvider } from "./convex-provider";

const { state, FakeClient } = vi.hoisted(() => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => {
      throw new Error("Not initialized");
    };
    let reject: (error: Error) => void = () => {
      throw new Error("Not initialized");
    };
    const promise = new Promise<T>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });

    return { promise, resolve, reject };
  }

  const state = {
    auth: {
      isLoaded: true,
      isSignedIn: true,
      userId: "owner-a",
      sessionId: "session-a",
      orgId: null,
      orgRole: null,
      sessionClaims: null,
    },
    getToken: vi.fn<() => Promise<string | null>>(),
    signOut: vi.fn(),
    connected: true,
    queryError: false,
    resume: new Set<(state: string) => void>(),
  };

  class FakeClient {
    static instances: FakeClient[] = [];
    provisioning = deferred<string>();
    close = vi.fn(() => Promise.resolve());
    clearAuth = vi.fn();
    fetchToken?: (options: {
      forceRefreshToken: boolean;
    }) => Promise<string | null>;
    reportAuth?: (isAuthenticated: boolean) => void;
    mutation = vi.fn((reference: Parameters<typeof getFunctionName>[0]) => {
      expect(getFunctionName(reference)).toBe("users:ensureCurrent");
      return this.provisioning.promise;
    });

    constructor(readonly url: string) {
      FakeClient.instances.push(this);
    }

    setAuth(
      fetchToken: NonNullable<FakeClient["fetchToken"]>,
      reportAuth: NonNullable<FakeClient["reportAuth"]>,
    ) {
      this.fetchToken = fetchToken;
      this.reportAuth = reportAuth;
    }
  }

  return { state, FakeClient };
});

vi.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({
    ...state.auth,
    getToken: state.getToken,
    signOut: state.signOut,
  }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ConvexReactClient: FakeClient,
  useConvexConnectionState: () => ({ isWebSocketConnected: state.connected }),
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      state.resume.add(listener);
      return { remove: () => state.resume.delete(listener) };
    },
  },
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
  Text: "Text",
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("./theme", () => ({ useTheme: () => ({}) }));
vi.mock("./sign-in-screen", () => ({
  SignInScreen: () => createElement("aside"),
}));
vi.mock("./mobile-ui", () => ({
  AppButton: ({ children, ...props }: { children: ReactNode }) =>
    createElement("Button", props, children),
  StatePanel: ({ title, action }: { title: string; action: ReactNode }) =>
    createElement("Panel", { title }, action),
}));

let renderer: ReactTestRenderer | undefined;
const convexUrl = "https://fake-deployment.convex.cloud";
const tree = () => (
  <MobilePortfolioProvider convexUrl={convexUrl}>
    <TextProbe />
  </MobilePortfolioProvider>
);
function TextProbe() {
  if (state.queryError) throw new Error("fake query failure");

  return createElement("article");
}
function latestClient() {
  const client = FakeClient.instances.at(-1);
  if (!client) throw new Error("Missing test client");

  return client;
}
async function render() {
  await act(async () => {
    renderer = create(tree());
  });
}
async function update() {
  await act(async () => {
    renderer?.update(tree());
  });
}
function hasPortfolio() {
  return (renderer?.root.findAllByType("article").length ?? 0) > 0;
}
async function retry() {
  const button = renderer?.root.findByProps({ label: "Try connecting again" });
  const onPress: unknown = button?.props.onPress;

  if (typeof onPress !== "function") throw new Error("Missing retry action");

  await act(async () => {
    onPress();
  });
}
async function authenticate(client = latestClient()) {
  await act(async () => client.reportAuth?.(true));
}
async function provision(client = latestClient()) {
  await act(async () => client.provisioning.resolve("fake-user-id"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.auth = {
    ...state.auth,
    isLoaded: true,
    isSignedIn: true,
    userId: "owner-a",
    sessionId: "session-a",
  };
  state.connected = true;
  state.queryError = false;
  FakeClient.instances = [];
  state.getToken.mockResolvedValue("fake-convex-jwt");
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("native Convex session", () => {
  it("selects the explicit deployment, requests a Convex JWT and provisions only after backend authentication", async () => {
    await render();
    const client = latestClient();
    expect(client.url).toBe(convexUrl);
    expect(client.mutation).not.toHaveBeenCalled();
    expect(hasPortfolio()).toBe(false);
    await expect(
      client.fetchToken?.({ forceRefreshToken: true }),
    ).resolves.toBe("fake-convex-jwt");
    expect(state.getToken).toHaveBeenCalledWith({
      template: "convex",
      skipCache: true,
    });

    await authenticate();
    expect(client.mutation).toHaveBeenCalledOnce();
    expect(hasPortfolio()).toBe(false);
    await provision();
    expect(hasPortfolio()).toBe(true);
  });

  it("does not connect or subscribe before Clerk loads or while signed out", async () => {
    state.auth.isLoaded = false;
    await render();
    expect(FakeClient.instances).toHaveLength(0);
    state.auth.isLoaded = true;
    state.auth.isSignedIn = false;
    await update();
    expect(FakeClient.instances).toHaveLength(0);
    expect(renderer?.root.findAllByType("aside")).toHaveLength(1);
  });

  it.each(["user", "session"])(
    "discards pending provisioning and private content when the %s changes",
    async (change) => {
      await render();
      const oldClient = latestClient();
      await authenticate(oldClient);
      if (change === "user") state.auth.userId = "owner-b";
      state.auth.sessionId = "session-b";
      await update();
      const newClient = latestClient();
      expect(newClient).not.toBe(oldClient);
      expect(oldClient.close).toHaveBeenCalledOnce();

      await provision(oldClient);
      await act(async () => oldClient.reportAuth?.(true));
      expect(hasPortfolio()).toBe(false);
      expect(newClient.mutation).not.toHaveBeenCalled();
      await authenticate(newClient);
      await provision(newClient);
      expect(hasPortfolio()).toBe(true);

      state.auth.isSignedIn = false;
      await update();
      expect(hasPortfolio()).toBe(false);
      expect(newClient.close).toHaveBeenCalledOnce();
    },
  );

  it("removes private content on auth loss and retries a failed authentication", async () => {
    await render();
    await authenticate();
    await provision();
    const client = latestClient();
    await act(async () => client.reportAuth?.(false));
    expect(hasPortfolio()).toBe(false);
    expect(
      renderer?.root.findByProps({ title: "Could not connect your account" }),
    ).toBeDefined();
    await retry();
    expect(client.close).toHaveBeenCalledOnce();
    await authenticate();
    await provision();
    expect(hasPortfolio()).toBe(true);
  });

  it("retries provisioning errors with a fresh client and ignores the old rejected request", async () => {
    await render();
    await authenticate();
    const client = latestClient();
    await act(async () =>
      client.provisioning.reject(new Error("fake service failure")),
    );
    expect(hasPortfolio()).toBe(false);
    expect(
      renderer?.root.findByProps({ title: "Could not prepare your account" }),
    ).toBeDefined();
    await retry();
    await authenticate();
    await provision();
    expect(hasPortfolio()).toBe(true);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("recovers query failures by replacing the client and resubscribing after provisioning", async () => {
    await render();
    await authenticate();
    await provision();
    const client = latestClient();
    state.queryError = true;
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await update();
      expect(hasPortfolio()).toBe(false);
      expect(
        renderer?.root.findByProps({ title: "Portfolio unavailable" }),
      ).toBeDefined();
      state.queryError = false;
      await retry();
      expect(client.close).toHaveBeenCalledOnce();
      await authenticate();
      await provision();
      expect(hasPortfolio()).toBe(true);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("shows reconnect status and retries authentication on foreground resume", async () => {
    await render();
    await authenticate();
    await provision();
    state.connected = false;
    await update();
    expect(JSON.stringify(renderer?.toJSON())).toContain("Reconnecting");
    const client = latestClient();
    await act(async () => client.reportAuth?.(false));
    await act(async () => {
      for (const listener of state.resume) listener("active");
    });
    expect(client.close).toHaveBeenCalledOnce();
    expect(latestClient()).not.toBe(client);
  });
});
