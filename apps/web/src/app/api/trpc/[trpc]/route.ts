import { appRouter, createApiContext } from "@investment-sync/api";
import { auth } from "@clerk/nextjs/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

function getEmail(sessionClaims: unknown): string | null {
  if (!sessionClaims || typeof sessionClaims !== "object") return null;
  const claims = sessionClaims as { email?: string; email_address?: string };
  return claims.email ?? claims.email_address ?? null;
}

async function handler(request: Request) {
  const session = await auth();

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () =>
      createApiContext({
        auth: {
          userId: session.userId,
          email: getEmail(session.sessionClaims),
        },
      }),
  });
}

export { handler as GET, handler as POST };
