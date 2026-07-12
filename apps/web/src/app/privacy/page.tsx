import type { Metadata } from "next";
import { Database, FileClock, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LegalFooter, LegalHeader } from "@/components/legal-page-chrome";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Investment Sync handles authentication, portfolio records, and uploaded source files.",
};

export default function PrivacyPage() {
  return (
    <main id="main-content" className="min-h-[100dvh]">
      <LegalHeader />

      <article
        id="legal-content"
        className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.55fr_1.45fr] lg:px-8 lg:py-20"
      >
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <p className="mt-6 text-xs font-semibold tracking-[0.16em] text-primary">
            Privacy
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
            Your portfolio data, explained plainly.
          </h1>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Last updated 12 July 2026
          </p>
          <Button asChild variant="outline" className="mt-8">
            <Link href="/">Return home</Link>
          </Button>
        </aside>

        <div className="overflow-hidden rounded-[2rem] border bg-card/78 shadow-[0_24px_90px_hsl(var(--foreground)/0.07)]">
          <section className="p-7 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-[-0.035em]">
              The short version
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Investment Sync processes account identity and the portfolio files
              you choose to upload. Access is scoped to your signed-in
              household. Original files expire after 30 days by default.
            </p>
          </section>

          <div className="grid border-t md:grid-cols-2">
            <PrivacyBlock
              icon={LockKeyhole}
              title="Account identity"
              description="Clerk handles authentication. Investment Sync stores the account email and household membership needed to authorize portfolio access."
            />
            <PrivacyBlock
              icon={Database}
              title="Portfolio records"
              description="Applied imports create normalized accounts, holdings, transactions, valuations, and import metadata used to render the portfolio."
            />
            <PrivacyBlock
              icon={FileClock}
              title="Original files"
              description="Uploaded source files are stored privately and retained for 30 days by default. Expired objects are removed during scheduled cleanup."
            />
            <PrivacyBlock
              icon={ShieldCheck}
              title="After file expiry"
              description="Normalized portfolio records remain after the original file expires so account history and portfolio views continue to work."
            />
          </div>

          <section className="border-t p-7 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-[-0.035em]">
              How the data is used
            </h2>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-muted-foreground">
              <li className="rounded-xl bg-secondary/42 px-4 py-3">
                Authenticate your session and identify the correct household.
              </li>
              <li className="rounded-xl bg-secondary/42 px-4 py-3">
                Parse, review, and apply supported portfolio exports.
              </li>
              <li className="rounded-xl bg-secondary/42 px-4 py-3">
                Calculate and display allocation, value, gains, and returns.
              </li>
              <li className="rounded-xl bg-secondary/42 px-4 py-3">
                Preserve import status after an original source file expires.
              </li>
            </ul>
          </section>

          <section className="grid gap-8 border-t p-7 sm:p-10 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold">Service providers</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Clerk provides authentication. Supabase provides the database
                and private file storage used by this application.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Controls in this build</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                You can review imports and connected accounts in the app. This
                build does not expose a self-service portfolio deletion action.
              </p>
            </div>
          </section>
        </div>
      </article>

      <LegalFooter current="privacy" />
    </main>
  );
}

function PrivacyBlock({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <section className="border-b p-7 last:border-b-0 md:border-r md:p-8 md:even:border-r-0 md:[&:nth-last-child(-n+2)]:border-b-0">
      <div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <h2 className="mt-6 text-lg font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </section>
  );
}
