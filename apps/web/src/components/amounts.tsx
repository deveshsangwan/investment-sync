"use client";

import { Eye, EyeOff } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import {
  formatCurrency,
  formatInr,
  formatCurrencyParts,
  formatSignedCurrency,
} from "../lib/format";
import { cn } from "../lib/utils";

const storageKey = "investment-sync.amounts-hidden";
const mask = "••••••";

/**
 * Amount visibility lives in localStorage rather than React state so the choice
 * survives navigation and reloads. Mask amounts until hydration can read that
 * preference, so a saved hidden state never exposes values during a reload.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readStoredPreference() {
  return window.localStorage.getItem(storageKey) === "true";
}

function amountsAreHiddenOnServer() {
  return true;
}

export function useAmountsVisibility() {
  const isHidden = useSyncExternalStore(
    subscribe,
    readStoredPreference,
    amountsAreHiddenOnServer,
  );

  const toggle = useCallback(() => {
    window.localStorage.setItem(storageKey, String(!readStoredPreference()));
    for (const listener of listeners) listener();
  }, []);

  return { isHidden, toggle };
}

export function Money({
  value,
  currency,
  signed = false,
  className,
}: {
  value: number;
  currency?: string | null;
  signed?: boolean;
  className?: string;
}) {
  const { isHidden } = useAmountsVisibility();
  const text = isHidden
    ? mask
    : signed
      ? formatSignedCurrency(value, currency)
      : formatCurrency(value, currency);

  return <span className={cn("number", className)}>{text}</span>;
}

/**
 * The headline amount: rupees at full size, paise quiet but present, so an
 * exact imported figure never has to be rounded away.
 */
export function DisplayAmount({
  value,
  currency,
  className,
}: {
  value: number;
  currency?: string | null;
  className?: string;
}) {
  const { isHidden } = useAmountsVisibility();

  if (isHidden) {
    return <span className={cn("number", className)}>{mask}</span>;
  }

  const { lead, fraction } = formatCurrencyParts(value, currency);
  return (
    <span className={cn("number", className)}>
      {lead}
      {fraction ? (
        <span className="text-[0.6em] text-muted-foreground">{fraction}</span>
      ) : null}
    </span>
  );
}

export function HideAmountsButton({ className }: { className?: string }) {
  const { isHidden, toggle } = useAmountsVisibility();
  const Icon = isHidden ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isHidden}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-[8px] border border-border/80 px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground motion-reduce:transition-none",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {isHidden ? "Show amounts" : "Hide amounts"}
    </button>
  );
}

export function useAmountFormatters() {
  const { isHidden } = useAmountsVisibility();

  return {
    formatInr: (value: number) => (isHidden ? mask : formatInr(value)),
    formatCurrency: (value: number, currency?: string | null) =>
      isHidden ? mask : formatCurrency(value, currency),
  };
}
