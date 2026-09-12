"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import {
  BriefcaseBusiness,
  CloudUpload,
  Landmark,
  LayoutDashboard,
} from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
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
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    const updateScrollState = () => setHasScrolled(window.scrollY > 0);

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });

    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  const isPublicPage =
    pathname === "/" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname === "/privacy" ||
    pathname === "/terms";

  if (isPublicPage) return children;

  return (
    <>
      <SignedIn>
        <div className="min-h-dvh">
          <a className="skip-link" href="#main-content">
            Skip to portfolio
          </a>

          <header
            className={cn(
              "sticky top-0 z-40 transition-[background-color,backdrop-filter] duration-200 motion-reduce:transition-none",
              hasScrolled
                ? "bg-background/75 backdrop-blur-xl"
                : "bg-background",
            )}
          >
            <div className="mx-auto flex h-16 max-w-[82rem] items-center gap-8 px-4 sm:px-6 lg:px-10">
              <Brand />
              <nav
                aria-label="Primary navigation"
                className="hidden h-full items-center gap-6 md:flex"
              >
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={item.isActive(pathname) ? "page" : undefined}
                    style={{
                      borderBottomColor: item.isActive(pathname)
                        ? "hsl(var(--foreground))"
                        : "transparent",
                    }}
                    className={cn(
                      "flex h-full items-center border-b-2 border-transparent text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                      item.isActive(pathname) &&
                        "border-foreground text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <ThemeToggle />
                <UserButton
                  afterSignOutUrl="/"
                  appearance={{
                    elements: {
                      rootBox: "shrink-0",
                      userButtonTrigger:
                        "grid size-11 shrink-0 place-items-center p-0",
                      avatarBox: "size-8 shrink-0 rounded-full",
                    },
                  }}
                />
              </div>
            </div>
          </header>

          {children}

          <nav
            aria-label="Mobile navigation"
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 grid grid-cols-4 rounded-xl border border-border/80 bg-card/95 p-1.5 shadow-[0_12px_36px_hsl(var(--foreground)/0.14)] backdrop-blur md:hidden"
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
                    "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[0.68rem] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 active:scale-[0.98]",
                    active && "bg-secondary text-foreground",
                  )}
                >
                  <Icon
                    className={cn("size-4", active && "text-primary")}
                    aria-hidden="true"
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </SignedIn>
      <SignedOut>{children}</SignedOut>
    </>
  );
}

function Brand() {
  return (
    <Link
      href="/dashboard"
      aria-label="Investment Sync overview"
      className="flex size-11 shrink-0 items-center justify-center"
    >
      <BrandMark className="size-11" />
    </Link>
  );
}
