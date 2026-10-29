import { getFunctionName, type FunctionReference } from "convex/server";

const connectedState = {
  hasInflightRequests: false,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
  hasEverConnected: true,
  connectionCount: 1,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
};

// Replace only the client transport. The production provider, Clerk adapter,
// query subscriptions, mutation hook, and error boundary all still run.
export const testTransport = {
  createdClients: 0,
  results: new Map<string, unknown>(),
  clients: new Set<TestConvexClient>(),
  queries: new Set<string>(),
  publish(name: string, result: unknown) {
    this.results.set(name, result);
    for (const client of this.clients) client.notify();
  },
  reset() {
    this.createdClients = 0;
    this.results.clear();
    this.clients.clear();
    this.queries.clear();
  },
};

export class TestConvexClient {
  private listeners = new Set<() => void>();

  constructor() {
    testTransport.createdClients += 1;
    testTransport.clients.add(this);
  }

  setAuth(
    fetchToken: (options: {
      forceRefreshToken: boolean;
    }) => Promise<string | null>,
    onAuthenticationChange: (isAuthenticated: boolean) => void,
  ) {
    void fetchToken({ forceRefreshToken: false }).then((token) =>
      onAuthenticationChange(Boolean(token)),
    );
  }

  clearAuth() {}

  mutation(reference: FunctionReference<"mutation">) {
    if (getFunctionName(reference) !== "users:ensureCurrent") {
      return Promise.reject(new Error("Unexpected native test mutation"));
    }

    return Promise.resolve("fake-user-id");
  }

  watchQuery(reference: FunctionReference<"query">) {
    const name = getFunctionName(reference);
    testTransport.queries.add(name);

    return {
      localQueryResult: () => {
        const result = testTransport.results.get(name);
        if (result instanceof Error) throw result;

        return result;
      },
      onUpdate: (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
  }

  connectionState() {
    return connectedState;
  }

  subscribeToConnectionState() {
    return () => undefined;
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  close() {
    this.listeners.clear();
    testTransport.clients.delete(this);
    return Promise.resolve();
  }
}
