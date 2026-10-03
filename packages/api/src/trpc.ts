import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { ApiContext } from "./context";
import { ensureMembership } from "./services/membership";
import {
  assertSourceWritesAllowed,
  SourceWritesPausedError,
} from "./source-writes";

const t = initTRPC.context<ApiContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure.use(({ type, next }) => {
  if (type === "mutation") {
    assertProcedureWritesAllowed();
  }

  return next();
});

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const membership = await ensureMembership(ctx).catch((error: unknown) => {
    if (error instanceof SourceWritesPausedError) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error.message,
        cause: error,
      });
    }

    throw error;
  });

  return next({
    ctx: {
      ...ctx,
      membership,
    },
  });
});

function assertProcedureWritesAllowed() {
  try {
    assertSourceWritesAllowed();
  } catch (error) {
    if (error instanceof SourceWritesPausedError) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error.message,
        cause: error,
      });
    }

    throw error;
  }
}
