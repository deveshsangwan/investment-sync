"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import {
  BriefcaseBusiness,
  CloudUpload,
  Landmark,
  LayoutDashboard,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    isActive: (pathname: string) =>
      pathname.startsWith("/dashboard") &&
      !pathname.startsWith("/dashboard/holdings"),
  },
  {
    href: "/holdings",
    label: "Holdings",
    icon: BriefcaseBusiness,
    isActive: (pathname: string) =>
      pathname.startsWith("/holdings") ||
      pathname.startsWith("/dashboard/holdings"),
  },
  {
    href: "/uploads",
    label: "Imports",
    icon: CloudUpload,
    isActive: (pathname: string) => pathname.startsWith("/uploads"),
  },
  {
    href: "/settings",
    label: "Accounts",
    icon: Landmark,
    isActive: (pathname: string) => pathname.startsWith("/settings"),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <SignedIn>
        <a className="skip-link" href="#main-content">
          Skip to portfolio
        </a>
        <header className="sticky top-0 z-40 border-b border-border/65 bg-background/88 shadow-[0_1px_0_hsl(var(--foreground)/0.02)] backdrop-blur-xl">
          <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
            <Link
              href="/dashboard"
              aria-label="Investment Sync overview"
              className="flex shrink-0 items-center gap-2.5"
            >
              <span className="grid size-9 place-items-center rounded-xl border border-primary/80 bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(var(--primary-foreground)/0.16),0_8px_20px_hsl(var(--primary)/0.16)]">
                <WalletCards className="size-[1.05rem]" aria-hidden="true" />
              </span>
              <span className="hidden text-sm font-semibold tracking-[-0.02em] sm:inline">
                Investment Sync
              </span>
            </Link>

            <nav
              aria-label="Primary navigation"
              className="mx-auto hidden items-center gap-0.5 rounded-xl border border-border/60 bg-card/55 p-1 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.025)] md:flex"
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={item.isActive(pathname)}
                />
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-1.5 md:ml-0">
              <Button asChild size="sm" className="hidden lg:inline-flex">
                <Link href="/uploads">
                  <CloudUpload className="size-4" aria-hidden="true" />
                  Import data
                </Link>
              </Button>
              <ThemeToggle />
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "size-9 rounded-xl",
                  },
                }}
              />
            </div>
          </div>
        </header>

        <nav
          aria-label="Mobile navigation"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 grid grid-cols-4 rounded-2xl border border-border/75 bg-background/94 p-1.5 shadow-[0_12px_36px_hsl(var(--foreground)/0.14)] backdrop-blur-xl md:hidden"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.isActive(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.68rem] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
                  active &&
                    "bg-accent text-accent-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SignedIn>
      {children}
    </div>
  );
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] duration-150 hover:bg-muted/55 hover:text-foreground",
        active &&
          "bg-accent text-accent-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]",
      )}
    >
      {label}
    </Link>
  );
}
