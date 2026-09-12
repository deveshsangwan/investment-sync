import { SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import { WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LegalHeader() {
  return (
    <SignedOut>
      <a className="skip-link" href="#legal-content">
        Skip to legal content
      </a>
      <header className="mx-auto flex h-16 w-full max-w-[84rem] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link
          href="/"
          aria-label="Investment Sync home"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-[-0.01em]"
        >
          <span className="grid size-8 place-items-center rounded-full bg-foreground text-background">
            <WalletCards className="size-4" aria-hidden="true" />
          </span>
          Investment Sync
        </Link>
        <Button asChild size="sm" variant="ghost">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>
    </SignedOut>
  );
}

export function LegalFooter({ current }: { current: "privacy" | "terms" }) {
  return (
    <footer className="mx-auto flex w-full max-w-[84rem] flex-col gap-4 border-t border-border px-5 pb-24 pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 md:pb-8 lg:px-12">
      <p>Investment Sync</p>
      <nav aria-label="Legal" className="flex gap-6">
        <LegalLink href="/privacy" isCurrent={current === "privacy"}>
          Privacy
        </LegalLink>
        <LegalLink href="/terms" isCurrent={current === "terms"}>
          Terms
        </LegalLink>
      </nav>
    </footer>
  );
}

function LegalLink({
  href,
  isCurrent,
  children,
}: {
  href: string;
  isCurrent: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      className={isCurrent ? "text-foreground" : "hover:text-foreground"}
      href={href}
      aria-current={isCurrent ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

/** Legal pages read as a document: one column, hairline-separated sections. */
export function LegalArticle({
  title,
  updatedAt,
  summary,
  children,
}: {
  title: string;
  updatedAt: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <article
      id="legal-content"
      className="mx-auto w-full max-w-[84rem] px-5 py-14 sm:px-8 lg:px-12"
    >
      <div className="max-w-[68ch]">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="number mt-3 text-sm text-muted-foreground">
          Last updated {updatedAt}
        </p>
        <p className="mt-6 text-base leading-7">{summary}</p>
      </div>
      <div className="mt-12 max-w-[68ch] divide-y divide-border border-t border-border">
        {children}
      </div>
    </article>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 py-8 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-8">
      <h2 className="text-sm font-medium">{heading}</h2>
      <div className="space-y-4 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
