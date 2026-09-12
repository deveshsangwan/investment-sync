import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { requireOwner } from "./model/auth";
import schema from "./schema";
import { modules } from "./test.setup";

const identity = {
  subject: "user_test_owner",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "test|user_test_owner",
  email: "owner@example.invalid",
};

const secondIdentity = {
  ...identity,
  subject: "user_test_second_owner",
  tokenIdentifier: "test|user_test_second_owner",
  email: "second-owner@example.invalid",
};

afterEach(() => vi.unstubAllEnvs());

describe("users", () => {
  it("provisions one Household and remains idempotent", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);

    const firstUserId = await t.mutation(api.users.ensureCurrent);
    const secondUserId = await t.mutation(api.users.ensureCurrent);

    expect(secondUserId).toBe(firstUserId);
    await expect(t.query(api.users.current)).resolves.toMatchObject({
      id: firstUserId,
      email: identity.email,
      role: "owner",
      householdName: "My Portfolio",
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(1);
      expect(await ctx.db.query("households").collect()).toHaveLength(1);
      expect(await ctx.db.query("householdMembers").collect()).toHaveLength(1);
    });
  });

  it("rejects unauthenticated access", async () => {
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.users.ensureCurrent)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(t.query(api.users.current)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it("keeps each identity in its own Household", async () => {
    const t = convexTest(schema, modules);
    const firstUser = t.withIdentity(identity);
    const secondUser = t.withIdentity(secondIdentity);

    await firstUser.mutation(api.users.ensureCurrent);
    await secondUser.mutation(api.users.ensureCurrent);

    const firstCurrent = await firstUser.query(api.users.current);
    const secondCurrent = await secondUser.query(api.users.current);
    expect(firstCurrent.householdId).not.toBe(secondCurrent.householdId);
    await expect(firstUser.run(requireOwner)).resolves.toMatchObject({
      household: { _id: firstCurrent.householdId },
    });
    await expect(secondUser.run(requireOwner)).resolves.toMatchObject({
      household: { _id: secondCurrent.householdId },
    });
  });

  it("rejects authenticated reads before provisioning", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);

    await expect(t.query(api.users.current)).rejects.toMatchObject({
      data: { code: "USER_NOT_PROVISIONED" },
    });
    await expect(t.run(requireOwner)).rejects.toMatchObject({
      data: { code: "USER_NOT_PROVISIONED" },
    });
  });

  it("rejects owner-only access for a viewer", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.users.ensureCurrent);
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("householdMembers").unique();

      if (!membership) {
        throw new Error("Expected seeded membership");
      }

      await ctx.db.patch(membership._id, { role: "viewer" });
    });

    await t.mutation(api.users.ensureCurrent);
    await expect(t.query(api.users.current)).resolves.toMatchObject({
      role: "viewer",
    });
    await expect(t.run(requireOwner)).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });

  it.each(["production", "preview", "", undefined])(
    "rejects fake seed without writes when APP_ENV is %s",
    async (environment) => {
      vi.stubEnv("APP_ENV", environment);
      const t = convexTest(schema, modules);

      await expect(
        t.mutation(internal.testing.seed.fakeDevelopmentData),
      ).rejects.toThrow("Fake seed is disabled");
      await t.run(async (ctx) => {
        expect(await ctx.db.query("users").collect()).toHaveLength(0);
        expect(await ctx.db.query("households").collect()).toHaveLength(0);
        expect(await ctx.db.query("householdMembers").collect()).toHaveLength(
          0,
        );
      });
    },
  );

  it.each(["development", "test"])(
    "seeds repeatably in %s",
    async (environment) => {
      vi.stubEnv("APP_ENV", environment);
      const t = convexTest(schema, modules);

      const firstResult = await t.mutation(
        internal.testing.seed.fakeDevelopmentData,
      );
      await expect(
        t.mutation(internal.testing.seed.fakeDevelopmentData),
      ).resolves.toEqual(firstResult);
      await t.run(async (ctx) => {
        expect(await ctx.db.query("users").collect()).toHaveLength(1);
        const user = await ctx.db.query("users").unique();
        expect(user?.email).toBe("fake-owner@example.invalid");
        expect(await ctx.db.query("households").collect()).toHaveLength(1);
        expect(await ctx.db.query("householdMembers").collect()).toHaveLength(
          1,
        );
      });
    },
  );

  it.each(["changed@example.invalid", undefined, ""])(
    "refreshes a present profile email and preserves it for an absent claim (%s)",
    async (email) => {
      const t = convexTest(schema, modules);
      const original = t.withIdentity(identity);
      const userId = await original.mutation(api.users.ensureCurrent);
      const changed = t.withIdentity({ ...identity, email });

      await expect(changed.mutation(api.users.ensureCurrent)).resolves.toBe(
        userId,
      );
      const current = await changed.query(api.users.current);
      expect(current.email).toBe(email || identity.email);
    },
  );

  it("preserves the Household name when provisioning an existing user", async () => {
    const t = convexTest(schema, modules).withIdentity(identity);
    await t.mutation(api.users.ensureCurrent);
    const current = await t.query(api.users.current);
    await t.run((ctx) =>
      ctx.db.patch("households", current.householdId, {
        name: "Family Investments",
      }),
    );

    await t.mutation(api.users.ensureCurrent);

    await expect(t.query(api.users.current)).resolves.toMatchObject({
      householdName: "Family Investments",
    });
  });

  it.each([
    "duplicate_subject",
    "missing_membership",
    "multiple_memberships",
    "missing_household",
    "owner_mismatch",
  ])("rejects %s without repairing or changing data", async (corruption) => {
    const t = convexTest(schema, modules).withIdentity(identity);
    const userId = await t.mutation(api.users.ensureCurrent);
    const current = await t.query(api.users.current);

    await t.run(async (ctx) => {
      const membership = await ctx.db.query("householdMembers").unique();

      if (!membership) {
        throw new Error("Expected provisioned membership");
      }

      switch (corruption) {
        case "duplicate_subject":
          await ctx.db.insert("users", { clerkSubject: identity.subject });
          break;
        case "missing_membership":
          await ctx.db.delete("householdMembers", membership._id);
          break;
        case "multiple_memberships":
          await ctx.db.insert("householdMembers", {
            userId,
            householdId: current.householdId,
            role: "owner",
          });
          break;
        case "missing_household":
          await ctx.db.delete("households", current.householdId);
          break;
        case "owner_mismatch": {
          const otherUserId = await ctx.db.insert("users", {
            clerkSubject: secondIdentity.subject,
          });
          await ctx.db.patch("households", current.householdId, {
            ownerUserId: otherUserId,
          });
          break;
        }
      }
    });

    const readState = () =>
      t.run(async (ctx) => ({
        users: await ctx.db.query("users").collect(),
        households: await ctx.db.query("households").collect(),
        memberships: await ctx.db.query("householdMembers").collect(),
      }));
    const before = await readState();
    const code =
      corruption === "duplicate_subject"
        ? "IDENTITY_CONFLICT"
        : "INVALID_MEMBERSHIP";

    await expect(t.query(api.users.current)).rejects.toMatchObject({
      data: { code },
    });
    await expect(t.mutation(api.users.ensureCurrent)).rejects.toMatchObject({
      data: { code },
    });
    await expect(t.run(requireOwner)).rejects.toMatchObject({ data: { code } });
    expect(await readState()).toEqual(before);
  });
});
