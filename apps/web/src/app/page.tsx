import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  BarChart3,
  CircleDollarSign,
  LockKeyhole,
  PieChart,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default async function HomePage() {
  const session = await auth();
  if (session.userId) redirect("/dashboard");

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
      <section className="min-w-0">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <WalletCards className="size-5" />
          </span>
          <span className="text-sm font-bold uppercase tracking-normal text-primary">
            Private portfolio tracker
          </span>
        </div>
        <h1 className="max-w-3xl text-5xl font-bold leading-none tracking-normal text-foreground sm:text-6xl">
          Investment Sync
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
          Upload Tickertape, Vested, and workbook exports, then review your
          household portfolio through one secure dashboard with allocation,
          returns, and import history in one place.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignInButton mode="modal">
            <Button size="lg">
              <LockKeyhole className="size-4" />
              Sign in
            </Button>
          </SignInButton>
          <Badge variant="secondary" className="h-10 px-3">
            Clerk protected
          </Badge>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ["Upload files", UploadCloud],
            ["Review allocation", PieChart],
            ["Track returns", BarChart3],
          ].map(([label, Icon]) => {
            const TypedIcon = Icon as typeof UploadCloud;
            return (
              <span
                key={label as string}
                className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground shadow-sm"
              >
                <TypedIcon className="size-4 text-primary" />
                {label as string}
              </span>
            );
          })}
        </div>
      </section>

      <section aria-label="Portfolio dashboard preview" className="min-w-0">
        <Card className="overflow-hidden shadow-2xl shadow-foreground/10">
          <CardHeader className="border-b bg-card/80">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase text-primary">
                  Total portfolio
                </p>
                <CardTitle className="mt-2 text-4xl">₹12,84,630</CardTitle>
              </div>
              <Badge variant="positive">+8.4%</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewMetric label="Invested" value="₹11,84,200" />
              <PreviewMetric
                label="Gain/Loss"
                value="₹1,00,430"
                className="positive"
              />
            </div>

            <div className="space-y-4">
              {[
                ["Indian equities", "52%", 74],
                ["Mutual funds", "31%", 58],
                ["US stocks", "12%", 36],
              ].map(([label, value, width]) => (
                <div key={label as string} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-muted-foreground">
                      {label as string}
                    </span>
                    <span className="font-semibold">{value as string}</span>
                  </div>
                  <Progress value={width as number} />
                </div>
              ))}
            </div>

            <div className="divide-y rounded-lg border">
              {[
                ["EQUITY-A", "Indian Stocks", "₹32,074"],
                ["Growth Fund", "Mutual Funds", "₹60,002"],
                ["US-EQ-A", "US Stocks", "$1,101"],
              ].map(([name, type, value]) => (
                <div
                  key={name}
                  className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-semibold">{name}</span>
                  <span className="text-muted-foreground">{type}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function PreviewMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/35 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
        <CircleDollarSign className="size-4 text-primary" />
        {label}
      </div>
      <p className={`mt-2 text-xl font-bold ${className ?? ""}`}>{value}</p>
    </div>
  );
}
