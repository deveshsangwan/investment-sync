"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { api } from "@investment-sync/backend/api";
import { Button } from "../../components/ui/button";
import {
  managementInputClass,
  useManagementOperation,
} from "./use-management-operation";

type Account = FunctionReturnType<typeof api.accounts.listAll>[number];

export function AccountManagement({
  accounts,
  isOwner,
}: {
  accounts: Account[];
  isOwner: boolean;
}) {
  return (
    <ul className="divide-y divide-border/70 border-y border-border/70">
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} isOwner={isOwner} />
      ))}
    </ul>
  );
}

function AccountRow({
  account,
  isOwner,
}: {
  account: Account;
  isOwner: boolean;
}) {
  const update = useMutation(api.accounts.update);
  const [isEditing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const operation = useManagementOperation();

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{account.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {account.provider} · {account.currency} ·{" "}
            {account.isArchived ? "Archived" : "Active"}
          </p>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={operation.isPending}
              onClick={() => {
                setName(account.name);
                setEditing(!isEditing);
              }}
            >
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={operation.isPending}
              onClick={() =>
                void operation.run(
                  () =>
                    update({
                      accountKey: account.id,
                      isArchived: !account.isArchived,
                    }),
                  account.isArchived
                    ? "Account restored to your portfolio."
                    : "Account archived. History is preserved.",
                )
              }
            >
              {account.isArchived ? "Unarchive" : "Archive"}
            </Button>
          </div>
        )}
      </div>
      {isEditing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void operation.run(async () => {
              await update({ accountKey: account.id, name });
              setEditing(false);
            }, "Account renamed.");
          }}
        >
          <label className="flex-1 text-sm">
            Account name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={managementInputClass}
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={operation.isPending || !name.trim()}
          >
            Save name
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      )}
      <p role="status" className="mt-2 text-sm">
        {operation.message}
      </p>
    </li>
  );
}
