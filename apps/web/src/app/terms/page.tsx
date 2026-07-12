import type { Metadata } from "next";
import {
  BarChart3,
  FileCheck2,
  Scale,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { LegalFooter, LegalHeader } from "@/components/legal-page-chrome";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Investment Sync.",
};

const sections = [
  {
    icon: WalletCards,
    title: "Purpose",
    body: "Investment Sync is a private portfolio organization tool. It combines records you provide into household views, calculations, and import history.",
  },
  {
    icon: ShieldCheck,
    title: "Your account",
    body: "Keep your sign-in method secure and use the service only for portfolio data you are authorized to access and upload.",
  },
  {
    icon: FileCheck2,
    title: "Your imports",
    body: "You are responsible for reviewing detected rows, warnings, dates, currencies, and totals before applying an import to the portfolio.",
  },
  {
    icon: BarChart3,
    title: "Calculations",
    body: "Values and returns depend on source data, available cash flows, exchange rates, and calculation assumptions. They can be incomplete or delayed.",
  },
] as const;

export default function TermsPage() {
  return (
    <main id="main-content" className="min-h-[100dvh]">
      <LegalHeader />

      <article
        id="legal-content"
        className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20"
      >
        <div className="max-w-3xl">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Scale className="size-5" aria-hidden="true" />
          </div>
          <p className="mt-6 text-xs font-semibold tracking-[0.16em] text-primary">
            Terms of use
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-6xl">
            Clear terms for a portfolio view.
          </h1>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Last updated 12 July 2026
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-[2rem] border bg-card/78 shadow-[0_24px_90px_hsl(var(--foreground)/0.07)]">
          <section className="p-7 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-[-0.035em]">
              Using Investment Sync
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              By using this application, you agree to use it lawfully and to
              review portfolio information before relying on it.
            </p>
          </section>

          <div className="grid border-t md:grid-cols-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <section
                  key={section.title}
                  className="border-b p-7 last:border-b-0 md:border-r md:p-8 md:even:border-r-0 md:[&:nth-last-child(-n+2)]:border-b-0"
                >
                  <div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <h2 className="mt-6 text-lg font-semibold">
                    {section.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {section.body}
                  </p>
                </section>
              );
            })}
          </div>

          <section className="grid gap-8 border-t p-7 sm:p-10 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold">Not investment advice</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Investment Sync does not recommend securities, provide tax or
                legal advice, or replace a qualified professional.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Availability</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The application and supported import formats can change. Keep
                copies of the source records you need outside the service.
              </p>
            </div>
          </section>

          <section className="border-t bg-secondary/40 p-7 sm:p-10">
            <h2 className="text-lg font-semibold">Privacy</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              The privacy page explains authentication, portfolio records, and
              the 30-day default retention period for original upload files.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link href="/privacy">Read privacy details</Link>
            </Button>
          </section>
        </div>
      </article>

      <LegalFooter current="terms" />
    </main>
  );
}
