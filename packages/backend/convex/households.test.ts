import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const identity = (subject: string) => ({
  subject,
  issuer: "https://fake.example",
  tokenIdentifier: `fake|${subject}`,
  email: `${subject}@example.invalid`,
  emailVerified: true,
});

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity("owner"));
  const invitee = t.withIdentity(identity("invitee"));
  const foreign = t.withIdentity(identity("foreign"));
  await Promise.all([
    owner.mutation(api.users.ensureCurrent),
    invitee.mutation(api.users.ensureCurrent),
    foreign.mutation(api.users.ensureCurrent),
  ]);
  return { t, owner, invitee, foreign };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("joins as viewer while preserving a provisioned invitee's household and data", async () => {
  const { t, owner, invitee } = await setup();
  const prior = await invitee.query(api.users.current);
  await t.run((ctx) =>
    ctx.db.insert("accounts", {
      householdId: prior.householdId,
      key: "fake",
      name: "Saved account",
      provider: "Fake",
      accountType: "test",
      currency: "INR",
    }),
  );
  const { token } = await owner.action(api.actions.householdInvites.create, {
    email: "INVITEE@example.invalid",
  });
  await invitee.mutation(api.households.acceptInvite, { token });
  const current = await invitee.query(api.users.current);
  expect(current.role).toBe("viewer");
  expect(current.householdId).toBe(
    (await owner.query(api.users.current)).householdId,
  );
  await expect(
    invitee.mutation(api.imports.createUpload, {
      fileName: "fake.csv",
      sizeBytes: 10,
    }),
  ).rejects.toThrow();
  await expect(
    invitee.action(api.actions.householdInvites.create, {
      email: "x@example.invalid",
    }),
  ).rejects.toThrow();
  await expect(invitee.query(api.households.pendingInvites)).rejects.toThrow();
  await expect(
    invitee.mutation(api.households.acceptInvite, { token }),
  ).rejects.toThrow();
  await invitee.mutation(api.users.ensureCurrent);
  await invitee.mutation(api.households.select, {
    householdId: prior.householdId,
  });
  expect(await invitee.query(api.accounts.list)).toMatchObject([
    { name: "Saved account" },
  ]);
  expect(await invitee.query(api.households.list)).toHaveLength(2);
});

it("rejects wrong email, unverified email, unauthenticated, expired, revoked and replaced links without revealing the household", async () => {
  const { t, owner, invitee, foreign } = await setup();
  const first = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  await expect(
    foreign.mutation(api.households.acceptInvite, first),
  ).rejects.toThrow("INVALID_INVITE");
  await expect(
    t
      .withIdentity({ ...identity("invitee"), emailVerified: false })
      .mutation(api.households.acceptInvite, first),
  ).rejects.toThrow("INVALID_INVITE");
  await expect(
    t.mutation(api.households.acceptInvite, first),
  ).rejects.toThrow();
  const second = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  await expect(
    invitee.mutation(api.households.acceptInvite, first),
  ).rejects.toThrow("INVALID_INVITE");
  const [pending] = await owner.query(api.households.pendingInvites);
  if (!pending) throw new Error("Missing invite");
  await owner.mutation(api.households.revokeInvite, { inviteId: pending.id });
  await expect(
    invitee.mutation(api.households.acceptInvite, second),
  ).rejects.toThrow("INVALID_INVITE");
  const third = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  vi.useFakeTimers();
  vi.advanceTimersByTime(7 * 86400000);
  await expect(
    invitee.mutation(api.households.acceptInvite, third),
  ).rejects.toThrow("INVALID_INVITE");
  const stored = await t.run((ctx) =>
    ctx.db.query("householdInvites").collect(),
  );
  expect(JSON.stringify(stored)).not.toContain(third.token);
});

it("enforces scoped removal and deliberate ownership transfer, revokes pending links and records audit evidence", async () => {
  const { owner, invitee, foreign } = await setup();
  const prior = await invitee.query(api.users.current);
  await invitee.mutation(
    api.households.acceptInvite,
    await owner.action(api.actions.householdInvites.create, {
      email: "invitee@example.invalid",
    }),
  );
  const member = (await owner.query(api.households.members)).find(
    (entry) => entry.role === "viewer",
  );
  const ownerMember = (await owner.query(api.households.members)).find(
    (entry) => entry.role === "owner",
  );
  if (!member || !ownerMember) throw new Error("Missing member");
  await expect(
    foreign.mutation(api.households.removeMember, { memberId: member.id }),
  ).rejects.toThrow();
  await expect(
    invitee.mutation(api.households.removeMember, { memberId: ownerMember.id }),
  ).rejects.toThrow();
  await expect(
    owner.mutation(api.households.removeMember, { memberId: ownerMember.id }),
  ).rejects.toThrow();
  await owner.action(api.actions.householdInvites.create, {
    email: "foreign@example.invalid",
  });
  await owner.mutation(api.households.transferOwnership, {
    memberId: member.id,
    confirm: "TRANSFER",
  });
  expect((await owner.query(api.users.current)).role).toBe("viewer");
  expect((await invitee.query(api.users.current)).role).toBe("owner");
  expect(await invitee.query(api.households.pendingInvites)).toEqual([]);
  await expect(
    owner.mutation(api.households.removeMember, { memberId: member.id }),
  ).rejects.toThrow();
  await invitee.mutation(api.households.removeMember, {
    memberId: ownerMember.id,
  });
  expect((await owner.query(api.users.current)).householdId).not.toBe(
    (await invitee.query(api.users.current)).householdId,
  );
  expect((await owner.query(api.users.current)).role).toBe("owner");
  const events = await invitee.query(api.households.auditEvents);
  expect(events.map((event) => event.action)).toEqual(
    expect.arrayContaining([
      "invite.created",
      "invite.accepted",
      "ownership.transferred",
      "member.removed",
    ]),
  );
  await invitee.mutation(api.households.select, {
    householdId: prior.householdId,
  });
});

it("handles independent concurrent redemptions and removal invalidates access immediately", async () => {
  const { owner, invitee } = await setup();
  const invite = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  const results = await Promise.allSettled([
    invitee.mutation(api.households.acceptInvite, invite),
    invitee.mutation(api.households.acceptInvite, invite),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const members = await owner.query(api.households.members);
  expect(members).toHaveLength(2);
  const member = members.find((entry) => entry.role === "viewer");
  if (!member) throw new Error("Missing viewer");
  await owner.mutation(api.households.removeMember, { memberId: member.id });
  expect(await invitee.query(api.households.members)).toHaveLength(1);
  await expect(
    invitee.mutation(api.households.select, {
      householdId: (await owner.query(api.users.current)).householdId,
    }),
  ).rejects.toThrow();
});

it("freezes management writes during migration verification", async () => {
  const { owner } = await setup();
  vi.stubEnv("MIGRATION_MODE", "production");
  await expect(
    owner.action(api.actions.householdInvites.create, {
      email: "invitee@example.invalid",
    }),
  ).rejects.toThrow("disabled during migration");
});

it("revokes outstanding links for a removed member and serializes acceptance against revocation", async () => {
  const { owner, invitee } = await setup();
  await invitee.mutation(
    api.households.acceptInvite,
    await owner.action(api.actions.householdInvites.create, {
      email: "invitee@example.invalid",
    }),
  );
  const pending = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  const member = (await owner.query(api.households.members)).find(
    (member) => member.role === "viewer",
  );
  if (!member) throw new Error("Missing viewer");
  await owner.mutation(api.households.removeMember, { memberId: member.id });
  await expect(
    invitee.mutation(api.households.acceptInvite, pending),
  ).rejects.toThrow();

  const racing = await owner.action(api.actions.householdInvites.create, {
    email: "invitee@example.invalid",
  });
  const [invite] = await owner.query(api.households.pendingInvites);
  if (!invite) throw new Error("Missing invite");
  const outcomes = await Promise.allSettled([
    owner.mutation(api.households.revokeInvite, { inviteId: invite.id }),
    invitee.mutation(api.households.acceptInvite, racing),
  ]);
  expect(outcomes[0]?.status).toBe("fulfilled");
  await expect(
    invitee.mutation(api.households.acceptInvite, racing),
  ).rejects.toThrow();
  expect(
    (await owner.query(api.households.members)).length,
  ).toBeLessThanOrEqual(2);
});
