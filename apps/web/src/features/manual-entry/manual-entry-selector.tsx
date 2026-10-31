"use client";

import { useId } from "react";
import { SelectField } from "@/components/ui/select-field";

export interface ManualEntrySelection {
  mode: "create" | "update";
  policyId: string | null;
}

export function ManualEntrySelector({
  selection,
  policies,
  isBusy,
  onChange,
}: {
  selection: ManualEntrySelection;
  policies: readonly { id: string; name: string; provider: string }[];
  isBusy: boolean;
  onChange: (selection: ManualEntrySelection) => void;
}) {
  const groupName = useId();

  return (
    <div className="mb-5 grid gap-4 border-b border-border/70 pb-5">
      <fieldset disabled={isBusy}>
        <legend className="sr-only">Entry type</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(
            [
              ["create", "Add new"],
              ["update", "Update existing"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="min-w-0 cursor-pointer">
              <input
                type="radio"
                name={groupName}
                value={mode}
                checked={selection.mode === mode}
                disabled={mode === "update" && policies.length === 0}
                onChange={() =>
                  onChange({
                    mode,
                    policyId:
                      selection.policyId ??
                      (policies.length === 1
                        ? (policies[0]?.id ?? null)
                        : null),
                  })
                }
                className="peer sr-only"
              />
              <span className="flex min-h-11 items-center justify-center rounded-lg px-2 text-center text-sm font-medium text-muted-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {selection.mode === "update" ? (
        <SelectField
          label="Policy to update"
          value={
            policies.some((policy) => policy.id === selection.policyId)
              ? (selection.policyId ?? "")
              : ""
          }
          placeholder="Choose an existing policy"
          options={policies.map((policy) => [
            policy.id,
            `${policy.name} (${policy.provider})`,
          ])}
          onChange={(policyId) => onChange({ mode: "update", policyId })}
          disabled={isBusy}
        />
      ) : null}
    </div>
  );
}
