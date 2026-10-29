import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { observable } from "@trpc/server/observable";
import { TRPCClientError } from "@trpc/client";
import type { ReactElement } from "react";
import superjson from "superjson";
import { trpc } from "../src/trpc";

// Exercise query subscriptions and refetches, while keeping transport replaceable
// when mobile moves to Convex in #58. Screen hooks are never mocked.
export function renderScreen(
  screen: ReactElement,
  respond: (path: string) => Promise<unknown>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  });
  const client = trpc.createClient({
    transformer: superjson,
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            void respond(op.path).then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error: unknown) =>
                observer.error(
                  TRPCClientError.from(
                    error instanceof Error
                      ? error
                      : new Error("Test transport failed"),
                  ),
                ),
            );
          }),
    ],
  });

  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{screen}</QueryClientProvider>
    </trpc.Provider>,
  );
}
