import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { ApiContext } from "./context";
import { ensureMembership } from "./services/membership";

const t = initTRPC.context<ApiContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const membership = await ensureMembership(ctx);
  return next({
    ctx: {
      ...ctx,
      membership,
    },
  });
});
