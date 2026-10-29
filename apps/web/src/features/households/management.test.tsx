// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "@investment-sync/backend/api";
import { ConvexError } from "convex/values";
import { HouseholdManagement } from "./household-management";
import { AccountManagement } from "./account-management";
import { AcceptInvitation } from "../../app/join/page";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  action: vi.fn(),
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useAction: () => mocks.action,
}));
vi.mock("../../app/query-cache-provider", () => ({
  useCachedQuery: (query: Parameters<typeof getFunctionName>[0]) =>
    mocks.query(getFunctionName(query)),
}));
vi.mock("../../app/convex-provider", () => ({
  ConvexSessionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  SignInButton: () => null,
  SignUpButton: () => null,
}));

// Fake IDs cross the Convex client boundary; no persisted fixture is used.
const householdId = "fake-household" as Id<"households">;
const userId = "fake-owner" as Id<"users">;
const viewerId = "fake-viewer" as Id<"users">;
const memberId = "fake-member" as Id<"householdMembers">;
const current = {
  id: userId,
  householdId,
  householdName: "Fake household",
  role: "owner" as const,
  email: "owner@example.invalid",
};
const account = {
  id: "fake-account",
  name: "Fake account",
  provider: "Fake broker",
  accountType: "indian_stock",
  currency: "INR" as const,
  isArchived: false,
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.action.mockReset().mockResolvedValue({ token: "a".repeat(64) });
  mocks.query.mockReset().mockImplementation((name: string) => {
    const data: Record<string, unknown> = {
      "households:list": [
        {
          id: householdId,
          name: "Fake household",
          role: "owner",
          isCurrent: true,
        },
      ],
      "households:members": [
        { id: "owner-member", userId, email: current.email, role: "owner" },
        {
          id: memberId,
          userId: viewerId,
          email: "viewer@example.invalid",
          role: "viewer",
        },
      ],
      "households:pendingInvites": [
        {
          id: "fake-invite",
          email: "pending@example.invalid",
          expiresAt: 1900000000000,
        },
      ],
    };
    return data[name];
  });
});
afterEach(cleanup);

it("lets an owner create a usable link and revoke a pending invitation", async () => {
  render(<HouseholdManagement current={current} />);
  expect(screen.getByText("Active · viewer")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Invitee email"), {
    target: { value: "invitee@example.invalid" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create invitation link" }),
  );
  await waitFor(() =>
    expect(mocks.action).toHaveBeenCalledWith({
      email: "invitee@example.invalid",
    }),
  );
  const link = screen.getByLabelText<HTMLInputElement>("Invitation link");
  expect(link.value).toBe(
    `${window.location.origin}/join#invite=${"a".repeat(64)}`,
  );
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({ inviteId: "fake-invite" }),
  );
});

it("requires confirmation for removal and typed confirmation before ownership transfer", async () => {
  render(<HouseholdManagement current={current} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(mocks.mutation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Confirm transfer" })
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Confirmation"), {
    target: { value: "TRANSFER" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({
      memberId,
      confirm: "TRANSFER",
    }),
  );
});

it("shows viewers members and accounts without owner management controls or invite queries", () => {
  render(
    <>
      <HouseholdManagement
        current={{ ...current, id: viewerId, role: "viewer" }}
      />
      <AccountManagement accounts={[account]} isOwner={false} />
    </>,
  );
  expect(screen.getByText("Fake account")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Create invitation link" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(mocks.query).not.toHaveBeenCalledWith("households:pendingInvites");
});

it("renames and archives an account and offers unarchive for saved accounts", async () => {
  const view = render(<AccountManagement accounts={[account]} isOwner />);
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Account name"), {
    target: { value: "New name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({
      accountKey: account.id,
      name: "New name",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({
      accountKey: account.id,
      isArchived: true,
    }),
  );
  view.rerender(
    <AccountManagement accounts={[{ ...account, isArchived: true }]} isOwner />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Unarchive" })
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  await waitFor(() =>
    expect(mocks.mutation).toHaveBeenCalledWith({
      accountKey: account.id,
      isArchived: false,
    }),
  );
});

it("accepts only after a click and keeps failed invitations retryable with an actionable error", async () => {
  mocks.mutation.mockRejectedValueOnce(
    new ConvexError({
      code: "INVALID_INVITE",
      message: "Ask the owner for a new link.",
    }),
  );
  render(<AcceptInvitation token={"b".repeat(64)} />);
  expect(mocks.mutation).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Accept invitation as viewer" }),
  );
  await screen.findByText("Ask the owner for a new link.");
  fireEvent.click(
    screen.getByRole("button", { name: "Accept invitation as viewer" }),
  );
  await screen.findByRole("link", { name: "Open household accounts" });
  expect(mocks.mutation).toHaveBeenLastCalledWith({ token: "b".repeat(64) });
});
