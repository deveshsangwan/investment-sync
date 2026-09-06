import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

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
      {action ? <div className="shrink-0 sm:pb-0.5">{action}</div> : null}
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
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-32 flex-col items-start gap-4 rounded-lg border border-dashed bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
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

export function PortfolioContentSkeleton({
  metricCount = 4,
}: {
  metricCount?: number;
}) {
  return (
    <div
      role="status"
      aria-label="Loading portfolio data"
      className="space-y-4"
    >
      <span className="sr-only">Loading portfolio data</span>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: metricCount }, (_, index) => (
          <Card key={index} className="shadow-none">
            <CardContent className="p-5 sm:p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-8 w-36" />
              <Skeleton className="mt-3 h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardContent className="p-5 sm:p-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-5 h-64 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

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
