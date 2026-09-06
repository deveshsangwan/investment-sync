import { SignedOut } from "@clerk/nextjs";
import { WalletCards } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function LegalHeader() {
  return (
    <SignedOut>
      <a className="skip-link" href="#legal-content">
        Skip to legal content
      </a>
      <header className="mx-auto flex h-[4.5rem] w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Investment Sync home"
          className="flex items-center gap-2.5 font-semibold tracking-[-0.02em]"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <WalletCards className="size-[1.05rem]" aria-hidden="true" />
          </span>
          <span>Investment Sync</span>
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
    <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 border-t px-4 pb-24 pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 md:pb-8 lg:px-8">
      <p>Investment Sync</p>
      <nav aria-label="Legal" className="flex gap-5">
        <LegalLink href="/privacy" active={current === "privacy"}>
          Privacy
        </LegalLink>
        <LegalLink href="/terms" active={current === "terms"}>
          Terms
        </LegalLink>
      </nav>
    </footer>
  );
}

function LegalLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      className={
        active ? "text-foreground" : "transition-colors hover:text-foreground"
      }
      href={href}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
