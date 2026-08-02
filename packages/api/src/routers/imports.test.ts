import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { ApiContext } from "../context";
import type { MembershipContext } from "../services/membership";
import { appRouter } from "../root";

function callerWithRole(role: string) {
  const membership: MembershipContext = {
    userId: "clerk_user",
    appUserId: "00000000-0000-0000-0000-000000000001",
    householdId: "00000000-0000-0000-0000-000000000002",
    role,
  };

  const ctx = {
    auth: { userId: "clerk_user", email: null },
    // ensureMembership returns the cached entry, so no database is touched
    // before the role guard runs.
    cache: new Map<string, Promise<unknown>>([
      ["membership", Promise.resolve(membership)],
    ]),
    db: {} as ApiContext["db"],
    supabase: {} as ApiContext["supabase"],
  } satisfies ApiContext;

  return appRouter.createCaller(ctx);
}

describe("imports.commit role guard", () => {
  it("rejects non-owner members with FORBIDDEN", async () => {
    const caller = callerWithRole("viewer");

    await expect(
      caller.imports.commit({
        importBatchId: "00000000-0000-0000-0000-000000000003",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets owners past the guard", async () => {
    const caller = callerWithRole("owner");

    // The empty `db` stub means commitImport itself blows up; all this asserts
    // is that the failure is no longer the FORBIDDEN guard.
    const error = await caller.imports
      .commit({ importBatchId: "00000000-0000-0000-0000-000000000003" })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).not.toBeNull();
    expect((error as TRPCError).code).not.toBe("FORBIDDEN");
  });
});
