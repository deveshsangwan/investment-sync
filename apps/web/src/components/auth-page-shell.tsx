import { FileClock, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";

export const authAppearance = {
  layout: {
    logoPlacement: "none" as const,
    socialButtonsVariant: "blockButton" as const,
    privacyPageUrl: "/privacy",
    termsPageUrl: "/terms",
  },
  variables: {
    colorPrimary: "hsl(var(--primary))",
    colorPrimaryForeground: "hsl(var(--primary-foreground))",
    colorForeground: "hsl(var(--foreground))",
    colorText: "hsl(var(--foreground))",
    colorTextSecondary: "hsl(var(--muted-foreground))",
    colorTextOnPrimaryBackground: "hsl(var(--primary-foreground))",
    colorMuted: "hsl(var(--muted))",
    colorMutedForeground: "hsl(var(--muted-foreground))",
    colorBackground: "transparent",
    colorInput: "hsl(var(--background))",
    colorInputForeground: "hsl(var(--foreground))",
    colorBorder: "hsl(var(--border))",
    colorRing: "hsl(var(--ring))",
    colorDanger: "hsl(var(--negative))",
    fontFamily: "var(--font-geist-sans)",
    borderRadius: "0.75rem",
    spacing: "1rem",
  },
  elements: {
    rootBox: "!mx-auto !w-full !max-w-sm",
    cardBox: "!mx-auto !w-full !max-w-full !shadow-none",
    card: "!mx-auto !w-full !max-w-full bg-transparent p-0 shadow-none",
    header: "text-left",
    headerTitle:
      "text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl",
    headerSubtitle: "mt-2 text-sm leading-6 text-muted-foreground",
    socialButtonsBlockButton:
      "h-11 !border-border !bg-background/70 !text-foreground shadow-none hover:!bg-accent",
    socialButtonsBlockButtonText: "!text-foreground",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
    formFieldLabel: "text-sm font-medium text-foreground",
    formFieldInput:
      "h-11 border-input bg-background/70 text-foreground shadow-none focus:border-primary focus:ring-primary",
    formButtonPrimary:
      "h-11 bg-primary text-sm font-semibold text-primary-foreground shadow-none hover:bg-primary/90",
    footerActionLink: "font-semibold text-primary hover:text-primary/80",
    footer: "!mx-auto !w-full !max-w-full !bg-transparent",
  },
};

export function AuthPageShell({
  eyebrow,
  title,
  description,
  securityDescription,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  securityDescription: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className="min-h-[100dvh]">
      <a className="skip-link" href="#auth-content">
        Skip to sign in
      </a>
      <header className="mx-auto flex h-[4.5rem] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <BrandLink />
        <Link
          href="/"
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back home
        </Link>
      </header>

      <section
        id="auth-content"
        className="mx-auto grid min-h-[calc(100dvh-4.5rem)] w-full max-w-7xl grid-cols-[minmax(0,1fr)] items-stretch px-4 pb-6 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(26rem,0.68fr)] lg:px-8"
      >
        <aside className="flex flex-col justify-between rounded-t-xl border border-b-0 bg-secondary/55 p-7 sm:p-10 lg:rounded-l-xl lg:rounded-tr-none lg:border-b lg:border-r-0 lg:p-14">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-primary">
              {eyebrow}
            </p>
            <h1 className="mt-5 max-w-lg text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              {description}
            </p>
          </div>

          <div className="mt-12 hidden gap-6 lg:grid">
            <TrustItem
              icon={ShieldCheck}
              title="Household-scoped access"
              description="Portfolio requests stay tied to the household attached to your account."
            />
            <TrustItem
              icon={FileClock}
              title="30-day file retention"
              description="Original upload files expire after 30 days by default."
            />
            <TrustItem
              icon={LockKeyhole}
              title="Authentication by Clerk"
              description={securityDescription}
            />
          </div>
        </aside>

        <div className="flex min-w-0 items-center justify-center rounded-b-xl border bg-card p-5 sm:p-9 lg:rounded-r-xl lg:rounded-bl-none">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-7xl items-center justify-center gap-5 px-4 py-6 text-xs text-muted-foreground sm:px-6 lg:px-8">
        <Link
          className="transition-colors hover:text-foreground"
          href="/privacy"
        >
          Privacy
        </Link>
        <Link className="transition-colors hover:text-foreground" href="/terms">
          Terms
        </Link>
      </footer>
    </main>
  );
}

function BrandLink() {
  return (
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
  );
}

function TrustItem({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-card text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
