import { formatSignedPercent } from "@/lib/format";
import { HideAmountsButton, Money } from "@/components/amounts";
import {
  AlertTriangle,
  RefreshCw,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      id="main-content"
      className={cn(
        "mx-auto w-full max-w-[82rem] px-4 pb-24 pt-6 sm:px-6 sm:pt-10 md:pb-12 lg:px-10",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  before,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  before?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <section className="mb-8 flex flex-col gap-5 pb-2 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="min-w-0">
        {before}
        {eyebrow && eyebrow !== title ? (
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[1.65rem] font-semibold leading-[1.08] tracking-[-0.04em] text-foreground sm:text-[1.85rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-[65ch] text-sm leading-6 text-muted-foreground sm:text-[0.95rem]">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-3">{meta}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pb-0.5">
        <HideAmountsButton />
        {action}
      </div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "neutral";
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden rounded-none border-0 bg-transparent shadow-none",
        className,
      )}
    >
      <CardContent className="px-0 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p
              className={cn(
                "number mt-2 break-words text-xl font-semibold sm:text-2xl",
                tone === "positive" && "positive",
                tone === "negative" && "negative",
              )}
            >
              {value}
            </p>
          </div>
          {Icon ? (
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </div>
          ) : null}
        </div>
        {detail ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SectionCard({
  title,
  children,
  description,
  action,
  className,
  contentClassName,
}: {
  title: string;
  children: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border/65">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={cn("pt-5", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-start gap-4 rounded-lg border border-dashed bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5",
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-card text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold tracking-[-0.01em]">{title}</p>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "We couldn't load this view",
  description = "The data request failed. Your saved portfolio has not changed.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-negative/25 bg-negative/5 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-negative"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {onRetry ? (
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={onRetry}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { PortfolioContentSkeleton } from "@/components/portfolio-skeleton";

export function TrendRow({
  label,
  sublabel,
  value,
  width,
}: {
  label: string;
  sublabel: string;
  value: string;
  width: number;
}) {
  return (
    <div className="grid grid-cols-[minmax(96px,1fr)_minmax(100px,1.4fr)_auto] items-center gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <Progress value={width} />
      <p className="number text-right text-sm font-semibold">{value}</p>
    </div>
  );
}

export function QualityBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const variant =
    lower.includes("exact") || lower.includes("source")
      ? "positive"
      : lower.includes("needs")
        ? "warning"
        : "secondary";
  return <Badge variant={variant}>{value}</Badge>;
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border border-border/70 bg-card",
        className,
      )}
    >
      {title ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="text-[0.82rem] font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 max-w-[54ch] text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn(title ? "px-5 pb-5 pt-4" : "p-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Hairline-separated facts beside a headline amount. */
export function StatRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:flex lg:items-start lg:gap-0">
      {children}
    </div>
  );
}

export function RailStat({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  detail?: string;
}) {
  return (
    <div className="min-w-0 xl:min-w-[8rem] lg:border-l lg:border-border/70 lg:px-4 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "number mt-1.5 whitespace-nowrap text-lg font-semibold tracking-[-0.015em]",
          toneClass(tone),
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

export type Tone = "positive" | "negative" | "flat" | undefined;

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "flat";
}

export function toneClass(tone: Tone) {
  if (tone === "positive") return "positive";
  if (tone === "negative") return "negative";
  return undefined;
}

/**
 * Signed money with a direction glyph. The glyph repeats what the sign says so
 * the outcome survives without colour.
 */
export function Outcome({
  amount,
  currency,
  percent,
  className,
}: {
  amount: number | null | undefined;
  currency?: string | null;
  percent?: number | null;
  className?: string;
}) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return (
      <span
        className={cn(
          "number inline-flex items-center gap-1 text-muted-foreground",
          className,
        )}
      >
        <Minus className="size-3.5" aria-hidden="true" />
        N/A
      </span>
    );
  }

  const tone = toneOf(amount);
  const Icon =
    tone === "positive"
      ? ArrowUpRight
      : tone === "negative"
        ? ArrowDownRight
        : Minus;
  const spoken =
    tone === "positive" ? "Gain" : tone === "negative" ? "Loss" : "No change";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1.5 font-medium",
        toneClass(tone) ?? "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{spoken} </span>
      <Money value={amount} currency={currency} signed />
      {percent === undefined ? null : (
        <span className="number text-muted-foreground">
          {formatSignedPercent(percent)}
        </span>
      )}
    </span>
  );
}

/** Percent on its own, signed and toned, for return columns. */
export function ReturnValue({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const usable =
    value !== null && value !== undefined && Number.isFinite(value);
  return (
    <span
      className={cn(
        "number font-medium",
        usable ? toneClass(toneOf(value)) : "text-muted-foreground",
        className,
      )}
    >
      {usable ? formatSignedPercent(value) : "N/A"}
    </span>
  );
}

/** A quiet horizontal proportion. Neutral by design: weight is not an outcome. */
export function WeightBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const width = Math.max(2, Math.min(100, value));
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-foreground/45"
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
