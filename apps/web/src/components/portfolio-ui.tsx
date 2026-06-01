import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
    <main className={cn("mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8", className)}>
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
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  before?: React.ReactNode;
}) {
  return (
    <section className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {before}
        {eyebrow ? (
          <p className="mb-2 text-xs font-bold uppercase tracking-normal text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-bold tracking-normal text-foreground sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "neutral";
  icon?: LucideIcon;
}) {
  return (
    <Card className="min-h-28 overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {label}
            </p>
            <p
              className={cn(
                "mt-2 truncate text-2xl font-bold tracking-normal",
                tone === "positive" && "positive",
                tone === "negative" && "negative",
              )}
            >
              {value}
            </p>
          </div>
          {Icon ? (
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary">
              <Icon className="size-4" />
            </div>
          ) : null}
        </div>
        {detail ? (
          <p className="mt-2 truncate text-xs font-medium text-muted-foreground">
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
  className,
}: {
  title: string;
  children: React.ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <Card className={cn("min-h-44", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
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
    <div className="flex min-h-28 flex-col items-start gap-3 rounded-lg border border-dashed bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-md bg-background text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
      <p className="text-right text-sm font-semibold">{value}</p>
    </div>
  );
}

export function QualityBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const variant = lower.includes("exact") || lower.includes("source")
    ? "positive"
    : lower.includes("needs")
      ? "negative"
      : "secondary";
  return <Badge variant={variant}>{value}</Badge>;
}
