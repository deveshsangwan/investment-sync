"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { manualPolicyInputSchema } from "@investment-sync/backend/manual-entry";
import { Button } from "@/components/ui/button";
import { useAmountFormatters } from "@/components/amounts";
import { LoaderCircle, Pencil } from "lucide-react";

export interface ManualPolicyInput {
  provider: string;
  name: string;
  investedAmount: string;
  currentValue: string;
  sourceDate: string;
}

const inputClass =
  "manual-entry-input h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60";

export function ManualPolicyForm({
  values,
  onChange,
  isUpdating,
  isBusy,
  onSave,
}: {
  values: ManualPolicyInput;
  onChange: (values: ManualPolicyInput) => void;
  isUpdating: boolean;
  isBusy: boolean;
  onSave: (values: ManualPolicyInput) => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { formatInr } = useAmountFormatters();
  const parsed = manualPolicyInputSchema.safeParse(values);
  const gain = parsed.success
    ? Number(parsed.data.currentValue) - Number(parsed.data.investedAmount)
    : null;

  function change(field: keyof ManualPolicyInput, value: string) {
    onChange({ ...values, [field]: value });
    setErrors((previous) => ({ ...previous, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isBusy) return;

    const result = manualPolicyInputSchema.safeParse(values);

    if (!result.success) {
      setErrors(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }

    if (result.data.sourceDate > today()) {
      setErrors({ sourceDate: "Choose today or an earlier date." });
      return;
    }

    await onSave(result.data);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <fieldset disabled={isBusy} className="grid gap-5">
        <div className={`grid gap-5 ${isUpdating ? "sm:grid-cols-2" : ""}`}>
          <PolicyNameField
            field="provider"
            value={values.provider}
            onChange={(value) => change("provider", value)}
            isUpdating={isUpdating}
            error={errors.provider}
          />
          <PolicyNameField
            field="name"
            value={values.name}
            onChange={(value) => change("name", value)}
            isUpdating={isUpdating}
            error={errors.name}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span id="investedAmount-label" className="font-medium">
              Amount paid
            </span>
            <input
              className={`${inputClass} number`}
              inputMode="decimal"
              value={values.investedAmount}
              onChange={(event) => change("investedAmount", event.target.value)}
              placeholder="1,80,000"
              maxLength={32}
              required
              aria-labelledby="investedAmount-label"
              aria-invalid={Boolean(errors.investedAmount)}
              aria-describedby="investedAmount-help investedAmount-error"
            />
            <span
              id="investedAmount-help"
              className="text-xs leading-5 text-muted-foreground"
            >
              Total paid so far for this investment.
            </span>
            <FieldError
              field="investedAmount"
              message={errors.investedAmount}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span id="currentValue-label" className="font-medium">
              Current value
            </span>
            <input
              className={`${inputClass} number`}
              inputMode="decimal"
              value={values.currentValue}
              onChange={(event) => change("currentValue", event.target.value)}
              placeholder="2,00,718"
              maxLength={32}
              required
              aria-labelledby="currentValue-label"
              aria-invalid={Boolean(errors.currentValue)}
              aria-describedby="currentValue-error"
            />
            <FieldError field="currentValue" message={errors.currentValue} />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm sm:max-w-64">
          <span className="font-medium">Value as of</span>
          <input
            className={inputClass}
            type="date"
            value={values.sourceDate}
            onChange={(event) => change("sourceDate", event.target.value)}
            max={today()}
            required
            aria-invalid={Boolean(errors.sourceDate)}
            aria-describedby={
              errors.sourceDate ? "sourceDate-error" : undefined
            }
          />
          <FieldError field="sourceDate" message={errors.sourceDate} />
        </label>
      </fieldset>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
        <p className="text-sm text-muted-foreground">
          Gain / loss{" "}
          <span
            className={`number ml-2 font-medium ${gain === null ? "" : gain >= 0 ? "positive" : "negative"}`}
          >
            {gain === null ? "—" : formatInr(gain)}
          </span>
        </p>
        <Button type="submit" disabled={isBusy}>
          {isBusy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {isBusy ? "Saving…" : isUpdating ? "Save update" : "Add policy"}
        </Button>
      </div>
    </form>
  );
}

function PolicyNameField({
  field,
  value,
  onChange,
  isUpdating,
  error,
}: {
  field: "provider" | "name";
  value: string;
  onChange: (value: string) => void;
  isUpdating: boolean;
  error?: string;
}) {
  const [editSession, setEditSession] = useState<{
    originalValue: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const inputId = useId();
  const label = field === "provider" ? "Insurer" : "Investment name";
  const errorMessage = editError ?? error;

  useEffect(() => {
    if (editSession) {
      inputRef.current?.focus();
      inputRef.current?.select();
      shouldRestoreFocus.current = true;
      return;
    }

    if (shouldRestoreFocus.current) {
      editButtonRef.current?.focus();
      shouldRestoreFocus.current = false;
    }
  }, [editSession]);

  function finishEditing() {
    const result = manualPolicyInputSchema.shape[field].safeParse(value);

    if (!result.success) {
      setEditError(result.error.issues[0]?.message ?? "Enter a name.");
      inputRef.current?.focus();
      return;
    }

    onChange(result.data);
    setEditError(undefined);
    setEditSession(null);
  }

  function cancelEditing() {
    if (!editSession) return;

    onChange(editSession.originalValue);
    setEditError(undefined);
    setEditSession(null);
  }

  if (isUpdating && !editSession) {
    return (
      <div className="grid min-w-0 gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <dl className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words text-sm font-medium leading-6">
              {value || "Not set"}
            </dd>
          </dl>
          <button
            ref={editButtonRef}
            type="button"
            aria-label={`Edit ${label.toLowerCase()}`}
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => {
              setEditError(undefined);
              setEditSession({ originalValue: value });
            }}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        </div>
        <FieldError field={field} message={errorMessage} />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={inputClass}
        value={value}
        onChange={(event) => {
          setEditError(undefined);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (!isUpdating || event.nativeEvent.isComposing) return;

          if (event.key === "Enter") {
            event.preventDefault();
            finishEditing();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
        }}
        placeholder={
          field === "provider" ? "e.g. HDFC Life" : "e.g. Goal Assure"
        }
        autoComplete="off"
        maxLength={field === "provider" ? 120 : 160}
        required
        aria-invalid={Boolean(errorMessage)}
        aria-describedby={errorMessage ? `${field}-error` : undefined}
      />
      <FieldError field={field} message={errorMessage} />
      {isUpdating ? (
        <>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={finishEditing}
            >
              Done
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelEditing}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FieldError({ field, message }: { field: string; message?: string }) {
  return (
    <span
      id={`${field}-error`}
      className="text-xs text-negative"
      role={message ? "alert" : undefined}
    >
      {message}
    </span>
  );
}

export function today() {
  const date = new Date();

  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
