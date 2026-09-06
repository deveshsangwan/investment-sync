import { BrandMark } from "@/components/brand-mark";
import { HomeMotion } from "@/components/home-motion";
import { PortfolioIllustration } from "@/components/portfolio-illustration";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileSpreadsheet,
  FolderOpen,
  LockKeyhole,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InstrumentIdentity } from "@/components/instrument-identity";

const sampleHoldings = [
  {
    name: "HDFC Bank",
    symbol: "HDFCBANK",
    assetClass: "indian_stock",
    value: "₹4,80,000",
    gain: "+14.29%",
  },
  {
    name: "Microsoft",
    symbol: "MSFT",
    assetClass: "us_stock",
    value: "₹3,15,000",
    gain: "+31.25%",
  },
  {
    name: "Parag Parikh Flexi Cap",
    symbol: null,
    assetClass: "mutual_fund",
    value: "₹4,27,000",
    gain: "+22.00%",
  },
];

export default async function HomePage() {
  const session = await auth();

  if (session.userId) redirect("/dashboard");

  return (
    <main id="main-content" className="min-h-dvh">
      <a className="skip-link" href="#public-content">
        Skip to content
      </a>
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Investment Sync home"
          className="flex size-11 items-center justify-center"
        >
          <BrandMark className="size-11" />
        </Link>
        <nav aria-label="Public navigation" className="flex items-center gap-5">
          <Link
            href="#sources"
            className="hidden text-sm text-muted-foreground sm:block"
          >
            Supported imports
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </nav>
      </header>

      <section
        id="public-content"
        className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20"
      >
        <div className="grid items-center gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          <div className="max-w-2xl">
            <h1 className="text-[40px] font-semibold leading-[1.12] tracking-[-0.05em] sm:text-[56px]">
              A clearer view of
              <br />
              what you own.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              Stocks, funds, and retirement savings. Bring your statements
              together and see your household portfolio in one place.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href="/sign-up">
                  Create your portfolio
                  <ChevronRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="#sources">See supported imports</Link>
              </Button>
            </div>
          </div>

          <HomeMotion className="home-art-scene">
            <PortfolioIllustration />
          </HomeMotion>
        </div>

        <HomeMotion className="home-preview mt-14 overflow-hidden rounded-[20px] border bg-card">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <WalletCards className="size-3.5" />
              Your portfolio
            </span>
            <span>Illustrative portfolio and marks</span>
          </div>
          <div className="grid">
            <div className="min-w-0 p-5 sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Total portfolio value
                  </p>
                  <p className="number mt-2 text-[34px] font-semibold tracking-tight">
                    ₹19,39,000
                    <span className="text-xl text-muted-foreground">.00</span>
                  </p>
                </div>
                <div className="text-sm">
                  <p className="flex items-center gap-1 text-positive">
                    <ArrowUpRight className="size-4" />
                    ₹2,69,000 total gain
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    From imported statements
                  </p>
                </div>
              </div>
              <div className="my-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_180px]">
                <div className="min-w-0">
                  <svg
                    className="h-28 w-full"
                    viewBox="0 0 600 110"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Illustrative portfolio value history"
                  >
                    <path
                      d="M0 100H600M0 55H600M0 10H600"
                      fill="none"
                      stroke="currentColor"
                      opacity=".08"
                    />
                    <path
                      className="portfolio-draw text-positive"
                      pathLength="1"
                      d="M0 93L70 85L140 79L210 65L280 72L350 44L420 49L490 22L550 27L600 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <div className="mt-3 flex justify-between text-[10px] text-muted-foreground">
                    <span>January</span>
                    <span>September</span>
                  </div>
                </div>
                <div className="space-y-4 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Indian stocks</span>
                    <span>36%</span>
                  </div>
                  <div className="h-1 rounded bg-foreground/70" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">US stocks</span>
                    <span>25%</span>
                  </div>
                  <div className="h-1 w-3/4 rounded bg-foreground/45" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Funds & retirement
                    </span>
                    <span>39%</span>
                  </div>
                </div>
              </div>
              <div className="divide-y border-t">
                {sampleHoldings.map((holding) => (
                  <div
                    key={holding.name}
                    className="flex items-center justify-between gap-4 py-4 last:pb-0"
                  >
                    <InstrumentIdentity {...holding} illustrative />
                    <div className="shrink-0 text-right">
                      <p className="number text-sm font-medium">
                        {holding.value}
                      </p>
                      <p className="number mt-1 text-xs text-positive">
                        {holding.gain}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </HomeMotion>
      </section>

      <section
        id="sources"
        className="mx-auto grid max-w-6xl gap-10 border-t px-5 py-16 sm:px-8 md:grid-cols-[0.85fr_1.15fr]"
      >
        <div>
          <FolderOpen className="size-6 text-muted-foreground" />
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">
            Start with your statements.
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            Upload an export you already have. Review the detected holdings and
            warnings before adding anything to your portfolio.
          </p>
          <Link
            href="/sign-up"
            className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium"
          >
            Import your first statement
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <div className="divide-y">
          {[
            {
              name: "Tickertape",
              detail: "Indian stock and mutual fund CSV exports",
              icon: FileSpreadsheet,
            },
            {
              name: "Vested / DriveWealth",
              detail: "US holdings workbooks",
              icon: UploadCloud,
            },
            {
              name: "Portfolio workbook",
              detail: "Investment Sync XLSX format",
              icon: FolderOpen,
            },
          ].map(({ name, detail, icon: Icon }) => (
            <div key={name} className="flex items-center gap-4 py-6 first:pt-0">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl border bg-card">
                <Icon className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium">{name}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {detail}
                </p>
              </div>
              <Check className="size-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-6 border-t px-5 py-12 sm:flex-row sm:items-start sm:px-8">
        <LockKeyhole className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <h2 className="text-base font-semibold">
            Your records stay in your household.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Signed-in access protects your portfolio. Original files expire
            after 30 days by default; imported records remain available.
            Investment Sync organizes your records and does not provide
            investment advice.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/privacy">Privacy details</Link>
        </Button>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 border-t px-5 py-7 text-xs text-muted-foreground sm:px-8">
        <p>Investment Sync</p>
        <nav aria-label="Legal" className="flex gap-6">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
