"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { clientErrorMessage } from "@investment-sync/backend/errors";
import { api, type Id } from "@investment-sync/backend/api";
import { ArrowLeft, Plus, Umbrella } from "lucide-react";
import { ConvexSessionGate } from "@/app/convex-provider";
import { ConvexQueryBoundary } from "@/components/convex-query-boundary";
import {
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
} from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/amounts";
import {
  ManualPolicyForm,
  today,
  type ManualPolicyInput,
} from "@/features/manual-entry/manual-policy-form";
import {
  ManualEntrySelector,
  type ManualEntrySelection,
} from "@/features/manual-entry/manual-entry-selector";
import { formatAsOfDate, formatDate } from "@/lib/format";

export function ManualEntryClient({
  initialPolicyId,
}: {
  initialPolicyId?: string;
}) {
  return (
    <PageShell>
      <PageHeader
        title="Manual entry"
        description="Add a ULIP or update its value using figures from your insurer's app."
        before={
          <Link
            href="/holdings"
            className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Holdings
          </Link>
        }
      />
      <ConvexSessionGate
        loading={
          <Skeleton
            className="h-96 w-full rounded-2xl"
            aria-label="Loading manual entry"
          />
        }
      >
        <ConvexQueryBoundary
          title="Manual entries could not be loaded"
          description="Try loading your policies again."
        >
          <ManualEntryData initialPolicyId={initialPolicyId} />
        </ConvexQueryBoundary>
      </ConvexSessionGate>
    </PageShell>
  );
}

function ManualEntryData({ initialPolicyId }: { initialPolicyId?: string }) {
  const current = useQuery(api.users.current);
  const policies = useQuery(api.manualPolicies.list);
  const createPolicy = useMutation(api.manualPolicies.create);
  const updateValue = useMutation(api.manualPolicies.updateValue);
  const commitEntry = useMutation(api.imports.commit);
  const [selection, setSelection] = useState<ManualEntrySelection>({
    mode: initialPolicyId ? "update" : "create",
    policyId: initialPolicyId ?? null,
  });
  const [drafts, setDrafts] = useState<Record<string, ManualPolicyInput>>({});
  const [activeBatchId, setActiveBatchId] =
    useState<Id<"importBatches"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const request = useRef<{ id: string; input: string } | null>(null);
  const saving = useRef(false);
  const activeEntry = useQuery(
    api.imports.get,
    activeBatchId ? { batchId: activeBatchId } : "skip",
  );
  const isUpdating = selection.mode === "update";
  const selected = isUpdating
    ? policies?.find((policy) => policy.id === selection.policyId)
    : undefined;
  const entry = activeEntry ?? selected?.entry;
  const isPublishing = entry?.status === "publishing";
  const hasFailed = entry?.status === "parsed" && Boolean(entry.errorMessage);
  const isOwner = current?.role === "owner";
  const formValues =
    selected?.entry?.status === "committed"
      ? selected.values
      : selected?.draftValues;
  const draftKey = selected
    ? `${selected.id}:${selected.entry?.id}`
    : "new-policy";
  const values =
    drafts[draftKey] ??
    (selected && formValues
      ? {
          provider: selected.provider,
          name: selected.name,
          ...formValues,
          sourceDate:
            selected.entry?.status === "committed"
              ? today()
              : formValues.sourceDate,
        }
      : {
          provider: "",
          name: "",
          investedAmount: "",
          currentValue: "",
          sourceDate: today(),
        });

  async function save(values: ManualPolicyInput) {
    if (saving.current || !isOwner || isPublishing) return;

    if (isUpdating && !selected?.entry) {
      setError("Choose an existing policy before saving an update.");
      return;
    }

    const input = JSON.stringify({
      policyId: selected?.id,
      expectedBatchId: selected?.entry?.id,
      ...values,
    });

    if (request.current?.input !== input)
      request.current = { id: crypto.randomUUID(), input };

    const requestId = request.current.id;

    saving.current = true;
    setIsSubmitting(true);
    setError(null);
    setActiveBatchId(null);

    try {
      const result =
        isUpdating && selected?.entry
          ? await updateValue({
              policyId: selected.id,
              expectedBatchId: selected.entry.id,
              ...values,
              requestId,
            })
          : await createPolicy({ ...values, requestId });

      setSelection({ mode: "update", policyId: result.policyId });
      setActiveBatchId(result.batchId);
      setDrafts((previous) => {
        const remaining = { ...previous };
        delete remaining[draftKey];

        return remaining;
      });
    } catch (cause) {
      setError(entryError(cause));
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  }

  async function retry() {
    if (!entry || saving.current || !isOwner) return;

    saving.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      await commitEntry({ batchId: entry.id });
      setActiveBatchId(entry.id);
    } catch (cause) {
      setError(entryError(cause));
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  }

  function select(next: ManualEntrySelection) {
    if (saving.current || isPublishing) return;

    setSelection(next);
    setActiveBatchId(null);
    setError(null);
    request.current = null;
  }

  if (!current || !policies)
    return (
      <Skeleton
        className="h-96 w-full rounded-2xl"
        aria-label="Loading policies"
      />
    );

  const missingPolicy = isUpdating && selection.policyId !== null && !selected;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-negative/30 bg-negative/5 p-4 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
        {activeEntry?.status === "committed" ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-positive/25 p-4 text-sm"
          >
            <span>Policy value saved.</span>
            <Link
              href="/dashboard"
              className="font-medium underline underline-offset-4"
            >
              View portfolio
            </Link>
          </div>
        ) : null}
        {hasFailed ? (
          <div
            role="alert"
            className="rounded-lg border border-negative/30 p-4 text-sm"
          >
            <p>
              {entry.errorMessage?.startsWith(
                "This import could not be published",
              )
                ? "The value could not be saved. Try again or update the entry."
                : (entry.errorMessage ?? "The value could not be saved.")}
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void retry()}
              disabled={isSubmitting}
            >
              Try saving again
            </Button>
          </div>
        ) : null}
        {isOwner ? (
          <Panel title="Policy entry" description="All amounts are in rupees.">
            <ManualEntrySelector
              selection={selection}
              policies={policies}
              isBusy={isSubmitting || isPublishing}
              onChange={select}
            />
            {!isUpdating || selected ? (
              <>
                {selected?.values ? (
                  <p className="mb-5 text-xs leading-5 text-muted-foreground">
                    Saved value as of {formatDate(selected.values.sourceDate)}.
                  </p>
                ) : null}
                <ManualPolicyForm
                  key={draftKey}
                  values={values}
                  onChange={(nextValues) =>
                    setDrafts((previous) => ({
                      ...previous,
                      [draftKey]: nextValues,
                    }))
                  }
                  isUpdating={isUpdating}
                  isBusy={isSubmitting || isPublishing}
                  onSave={save}
                />
              </>
            ) : (
              <p
                role={missingPolicy ? "alert" : "status"}
                className="py-5 text-sm leading-6 text-muted-foreground"
              >
                {missingPolicy
                  ? "This policy is unavailable. Choose another policy or add a new one."
                  : "Choose a policy to load its saved values."}
              </p>
            )}
          </Panel>
        ) : (
          <Panel title="Manual entries">
            <p className="text-sm text-muted-foreground">
              Only the household owner can add or update policy values.
            </p>
          </Panel>
        )}
        <p className="px-1 text-xs leading-5 text-muted-foreground">
          Enter the market-linked value on the selected date, not the guaranteed
          maturity amount. Entries record values only, so XIRR is not
          calculated.
        </p>
      </div>
      <Panel
        title="Policies"
        action={
          isOwner ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isSubmitting || isPublishing}
              onClick={() => select({ ...selection, mode: "create" })}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add new
            </Button>
          ) : undefined
        }
      >
        {policies.length === 0 ? (
          <EmptyState icon={Umbrella} title="No policies yet" />
        ) : (
          <ul className="divide-y divide-border/70">
            {policies.map((policy) => (
              <li key={policy.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {policy.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {policy.provider}
                    </p>
                  </div>
                  {isOwner ? (
                    <Button
                      variant={
                        selected?.id === policy.id ? "secondary" : "outline"
                      }
                      size="sm"
                      disabled={isSubmitting || isPublishing}
                      onClick={() =>
                        select({ mode: "update", policyId: policy.id })
                      }
                    >
                      Update
                    </Button>
                  ) : null}
                </div>
                {policy.values ? (
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Amount paid</dt>
                      <dd className="mt-1 text-sm font-medium">
                        <Money value={Number(policy.values.investedAmount)} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Current value</dt>
                      <dd className="mt-1 text-sm font-medium">
                        <Money value={Number(policy.values.currentValue)} />
                      </dd>
                    </div>
                  </dl>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  {policy.entry?.status === "publishing"
                    ? "Saving value…"
                    : policy.entry?.status === "parsed"
                      ? "Value needs saving"
                      : policy.values
                        ? formatAsOfDate(policy.values.sourceDate)
                        : "No value saved"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function entryError(cause: unknown) {
  return clientErrorMessage(
    cause,
    "The value could not be saved. Please try again.",
  );
}
