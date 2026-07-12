import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  BarChart3,
  FileClock,
  FileSpreadsheet,
  LockKeyhole,
  PieChart,
  ShieldCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

const sources = [
  {
    name: "Tickertape",
    format: "Stocks and mutual fund CSV exports",
    description:
      "Bring Indian equity and mutual fund holdings into the same household view.",
    icon: BarChart3,
    className: "md:col-span-7 md:row-span-2",
  },
  {
    name: "Vested / DriveWealth",
    format: "US holdings workbook",
    description: "Review US investments alongside INR-denominated assets.",
    icon: UploadCloud,
    className: "md:col-span-5",
  },
  {
    name: "Portfolio workbook",
    format: "Investment Sync XLSX format",
    description: "Use one workbook for supported assets beyond broker exports.",
    icon: FileSpreadsheet,
    className: "md:col-span-5",
  },
] as const;

export default async function HomePage() {
  const session = await auth();
  if (session.userId) redirect("/dashboard");

  return (
    <main id="main-content" className="min-h-[100dvh] overflow-hidden">
      <a className="skip-link" href="#public-content">
        Skip to content
      </a>
      <header className="mx-auto flex h-[4.5rem] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Investment Sync home"
          className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_28px_hsl(var(--primary)/0.2)]">
            <WalletCards className="size-[1.05rem]" aria-hidden="true" />
          </span>
          <span>Investment Sync</span>
        </Link>

        <nav
          aria-label="Public navigation"
          className="flex items-center gap-1 sm:gap-2"
        >
          <Link
            href="#sources"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Sources
          </Link>
          <Link
            href="#privacy"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
          >
            Privacy
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </nav>
      </header>

      <section
        id="public-content"
        className="mx-auto grid min-h-[calc(100dvh-4.5rem)] w-full max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:px-8 lg:py-16"
      >
        <div className="min-w-0 lg:pb-8">
          <p className="mb-5 text-xs font-semibold tracking-[0.16em] text-primary">
            Private household portfolio
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-foreground sm:text-6xl lg:text-7xl">
            One household. Every investment.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            Bring Indian and US investments into one private household view,
            with returns, allocation, and import history kept in context.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Create portfolio
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#sources">Supported sources</Link>
            </Button>
          </div>
        </div>

        <IllustrativePortfolio />
      </section>

      <section
        id="sources"
        aria-labelledby="sources-title"
        className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24 lg:px-8"
      >
        <div className="max-w-2xl">
          <h2
            id="sources-title"
            className="text-3xl font-semibold tracking-[-0.045em] sm:text-5xl"
          >
            Start with exports you already have.
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Upload a supported file, review what was detected, then apply it to
            your household portfolio.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-12 md:grid-rows-2">
          {sources.map((source) => {
            const Icon = source.icon;
            return (
              <article
                key={source.name}
                className={`group flex min-h-56 flex-col justify-between rounded-2xl border bg-card/72 p-6 shadow-[0_18px_60px_hsl(var(--foreground)/0.05)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_22px_70px_hsl(var(--foreground)/0.08)] sm:p-7 ${source.className}`}
              >
                <div className="grid size-11 place-items-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="mt-10">
                  <p className="text-sm font-medium text-primary">
                    {source.format}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
                    {source.name}
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                    {source.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        id="privacy"
        aria-labelledby="privacy-title"
        className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24 lg:px-8"
      >
        <div className="grid overflow-hidden rounded-[2rem] border bg-card/74 shadow-[0_24px_90px_hsl(var(--foreground)/0.07)] lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-7 sm:p-10 lg:p-14">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </div>
            <h2
              id="privacy-title"
              className="mt-8 max-w-xl text-3xl font-semibold tracking-[-0.045em] sm:text-5xl"
            >
              Private by structure, clear by policy.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Portfolio requests are scoped to your signed-in household, and
              original files live in private storage before expiry.
            </p>
            <Button asChild variant="outline" className="mt-8">
              <Link href="/privacy">Read privacy details</Link>
            </Button>
          </div>

          <div className="grid content-center gap-8 border-t bg-secondary/45 p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
            <TrustPoint
              icon={LockKeyhole}
              title="Authenticated access"
              description="Clerk handles sign-in while portfolio access remains scoped to your household."
            />
            <TrustPoint
              icon={FileClock}
              title="30-day source-file retention"
              description="Original uploads expire after 30 days by default. Normalized data remains for your dashboard."
            />
            <TrustPoint
              icon={PieChart}
              title="A view, not advice"
              description="Investment Sync organizes the records you provide. It does not recommend investments."
            />
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-5 border-t px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>Investment Sync. Private portfolio organization for households.</p>
        <nav aria-label="Legal" className="flex items-center gap-5">
          <Link
            className="transition-colors hover:text-foreground"
            href="/privacy"
          >
            Privacy
          </Link>
          <Link
            className="transition-colors hover:text-foreground"
            href="/terms"
          >
            Terms
          </Link>
        </nav>
      </footer>
    </main>
  );
}

function IllustrativePortfolio() {
  return (
    <article
      aria-label="Illustrative portfolio overview"
      className="relative min-w-0 rounded-[2rem] border bg-card/80 p-5 shadow-[0_28px_100px_hsl(var(--foreground)/0.12)] backdrop-blur sm:p-7 lg:translate-y-5"
    >
      <div className="flex items-start justify-between gap-4 border-b pb-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Illustrative portfolio
          </p>
          <p className="number mt-3 text-3xl font-semibold sm:text-4xl">
            ₹12.84L
          </p>
        </div>
        <span className="rounded-lg border border-positive/20 bg-positive/10 px-2.5 py-1 text-sm font-semibold text-positive">
          +8.4%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 py-6">
        <div>
          <p className="text-xs text-muted-foreground">Invested</p>
          <p className="number mt-1.5 text-lg font-semibold">₹11.84L</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total gain</p>
          <p className="number mt-1.5 text-lg font-semibold text-positive">
            ₹1.00L
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-secondary/58 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold">Allocation</p>
          <p className="text-xs text-muted-foreground">Example data</p>
        </div>
        <div
          className="mt-5 grid h-3 grid-cols-[52fr_31fr_17fr] overflow-hidden rounded-full"
          aria-hidden="true"
        >
          <span className="bg-chart-1" />
          <span className="bg-chart-3" />
          <span className="bg-chart-5" />
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <Allocation label="Indian equities" value="52%" swatch="bg-chart-1" />
          <Allocation label="Mutual funds" value="31%" swatch="bg-chart-3" />
          <Allocation label="US stocks" value="17%" swatch="bg-chart-5" />
        </dl>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border bg-background/55 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <FileSpreadsheet className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Review before applying</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Detected rows and warnings stay visible during import.
          </p>
        </div>
      </div>
    </article>
  );
}

function Allocation({
  label,
  value,
  swatch,
}: {
  label: string;
  value: string;
  swatch: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`size-2 rounded-sm ${swatch}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="number mt-1.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function TrustPoint({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof LockKeyhole;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-primary shadow-sm">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <h3 className="font-semibold tracking-[-0.015em]">{title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
