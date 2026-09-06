import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { householdMembers, users } from "@investment-sync/db";
import { appRouter } from "../root";
import {
  contextFor,
  createHousehold,
  requireTestDatabaseUrlInCi,
  resetDatabase,
  testDatabase,
  testDatabaseUrl,
} from "../services/import-test-support";

requireTestDatabaseUrlInCi();

const describeDb = testDatabaseUrl ? describe : describe.skip;

describeDb("auth.me household membership", () => {
  const database = testDatabase();

  function getDatabase() {
    if (!database) throw new Error("TEST_DATABASE_URL is required");

    return database;
  }

  beforeEach(async () => {
    await resetDatabase(getDatabase());
  });

  it("returns the household profile and read permissions for a viewer", async () => {
    const db = getDatabase();
    const owner = await createHousehold(db);
    const viewerId = randomUUID();
    const clerkUserId = `test_${randomUUID()}`;
    const email = "viewer@example.com";

    await db.insert(users).values({ id: viewerId, clerkUserId, email });
    await db.insert(householdMembers).values({
      householdId: owner.householdId,
      userId: viewerId,
      role: "viewer",
    });

    const caller = appRouter.createCaller(contextFor(db, { clerkUserId, email }));
    const profile = await caller.auth.me();

    expect(profile).toMatchObject({
      user: { id: viewerId, email, householdId: owner.householdId },
      permissions: { canUpload: false, canManageHousehold: false },
    });
  });

  it("uses the selected membership even when the user owns another household", async () => {
    const db = getDatabase();
    const user = await createHousehold(db);
    const shared = await createHousehold(db);

    await db.insert(householdMembers).values({
      householdId: shared.householdId,
      userId: user.appUserId,
      role: "viewer",
      createdAt: new Date("2000-01-01"),
    });

    const caller = appRouter.createCaller(
      contextFor(db, { clerkUserId: user.userId }),
    );
    const profile = await caller.auth.me();

    expect(profile.user?.householdId).toBe(shared.householdId);
    expect(profile.permissions.canManageHousehold).toBe(false);
  });

  it("preserves the owner's profile and management permissions", async () => {
    const db = getDatabase();
    const owner = await createHousehold(db);
    const caller = appRouter.createCaller(
      contextFor(db, { clerkUserId: owner.userId }),
    );

    expect(await caller.auth.me()).toMatchObject({
      user: { id: owner.appUserId, householdId: owner.householdId },
      permissions: { canUpload: true, canManageHousehold: true },
    });
  });
});
