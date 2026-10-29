"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@investment-sync/backend/api";
import { useCachedQuery } from "../../app/query-cache-provider";
import { Panel } from "../../components/portfolio-ui";
import { Button } from "../../components/ui/button";
import {
  managementInputClass,
  useManagementOperation,
} from "./use-management-operation";

type Current = FunctionReturnType<typeof api.users.current>;
type Member = FunctionReturnType<typeof api.households.members>[number];

export function HouseholdManagement({ current }: { current: Current }) {
  const households = useCachedQuery(api.households.list);
  const members = useCachedQuery(api.households.members);
  const select = useMutation(api.households.select);
  const operation = useManagementOperation();

  return (
    <section className="mt-8 space-y-4" aria-label="Household sharing">
      <Panel title="Household members">
        {households && households.length > 1 && (
          <div className="mb-5">
            <p className="mb-2 text-xs text-muted-foreground">
              Each household keeps its own accounts and history.
            </p>
            <div className="flex flex-wrap gap-2">
              {households.map((household) => (
                <Button
                  key={household.id}
                  size="sm"
                  variant={household.isCurrent ? "secondary" : "outline"}
                  disabled={household.isCurrent || operation.isPending}
                  onClick={() =>
                    void operation.run(
                      () => select({ householdId: household.id }),
                      "Household changed.",
                    )
                  }
                >
                  {household.name} ({household.role})
                  {household.isCurrent ? " · Current" : ""}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="mb-4 text-xs text-muted-foreground">
          Owners manage accounts, imports, and sharing. Viewers can read the
          portfolio.
        </p>
        {!members ? (
          <p role="status">Loading members…</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} current={current} />
            ))}
          </ul>
        )}
        <p role="status" className="mt-3 text-sm">
          {operation.message}
        </p>
      </Panel>
      {current.role === "owner" && <InvitationManagement />}
    </section>
  );
}

function MemberRow({ member, current }: { member: Member; current: Current }) {
  const remove = useMutation(api.households.removeMember);
  const transfer = useMutation(api.households.transferOwnership);
  const operation = useManagementOperation();
  const [confirmation, setConfirmation] = useState<
    "remove" | "transfer" | null
  >(null);
  const [phrase, setPhrase] = useState("");
  const label = member.email ?? "Household member";

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="break-all font-medium">
            {label}
            {member.userId === current.id ? " (you)" : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Active · {member.role}
          </p>
        </div>
        {current.role === "owner" && member.role === "viewer" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={operation.isPending}
              onClick={() => {
                setConfirmation("transfer");
                setPhrase("");
              }}
            >
              Transfer ownership
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={operation.isPending}
              onClick={() => setConfirmation("remove")}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
      {confirmation && (
        <form
          className="mt-3 space-y-3 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void operation.run(
              async () => {
                if (confirmation === "transfer")
                  await transfer({ memberId: member.id, confirm: "TRANSFER" });
                else await remove({ memberId: member.id });
                setConfirmation(null);
              },
              confirmation === "transfer"
                ? "Ownership transferred. You are now a viewer."
                : "Member removed.",
            );
          }}
        >
          <p className="text-sm">
            {confirmation === "transfer"
              ? `Make ${label} the owner? You will become a viewer and pending invitations will be revoked. Type TRANSFER to confirm.`
              : `Remove ${label}? Their access to this household will end. Portfolio history stays here.`}
          </p>
          {confirmation === "transfer" && (
            <label className="block text-sm">
              Confirmation
              <input
                className={managementInputClass}
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={
                operation.isPending ||
                (confirmation === "transfer" && phrase !== "TRANSFER")
              }
            >
              {confirmation === "transfer"
                ? "Confirm transfer"
                : "Confirm removal"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <p role="status" className="mt-2 text-sm">
        {operation.message}
      </p>
    </li>
  );
}

function InvitationManagement() {
  const pending = useCachedQuery(api.households.pendingInvites);
  const create = useAction(api.actions.householdInvites.create);
  const revoke = useMutation(api.households.revokeInvite);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const operation = useManagementOperation();

  return (
    <Panel title="Invite a viewer">
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        Create a link and share it yourself. The recipient must sign in with
        this verified email. Links expire after seven days and can be used once.
        Creating another link for the same email replaces the old one.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setLink("");
          void operation.run(async () => {
            const result = await create({ email });
            setLink(`${window.location.origin}/join#invite=${result.token}`);
          }, "Invitation link created. Share it with the recipient.");
        }}
      >
        <label className="min-w-48 flex-1 text-sm">
          Invitee email
          <input
            type="email"
            required
            maxLength={254}
            className={managementInputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={operation.isPending}>
          Create invitation link
        </Button>
      </form>
      {link && (
        <div className="mt-4 space-y-2">
          <label className="block text-sm">
            Invitation link
            <input
              readOnly
              value={link}
              className={managementInputClass}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void operation.run(
                () => navigator.clipboard.writeText(link),
                "Invitation link copied.",
              )
            }
          >
            Copy link
          </Button>
        </div>
      )}
      <p role="status" className="my-3 text-sm">
        {operation.message}
      </p>
      <h3 className="text-sm font-medium">Pending invitations</h3>
      {!pending ? (
        <p className="mt-2 text-xs">Loading invitations…</p>
      ) : pending.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No pending invitations.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {pending.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 text-sm">
                <p className="break-all">{invite.email}</p>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(invite.expiresAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={operation.isPending}
                onClick={() =>
                  void operation.run(async () => {
                    await revoke({ inviteId: invite.id });
                    setLink("");
                  }, "Invitation revoked.")
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
