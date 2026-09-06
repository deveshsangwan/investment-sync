"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import {
  BriefcaseBusiness,
  CloudUpload,
  Landmark,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <>
      <SignedIn>
        <div className="min-h-dvh">
          <a className="skip-link" href="#main-content">
            Skip to portfolio
          </a>

          <aside
            id="desktop-sidebar"
            className={cn(
              "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border/75 bg-background transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
              sidebarCollapsed ? "w-[4.5rem]" : "w-52",
            )}
          >
            <div
              className={cn(
                "flex h-16 items-center border-b border-border/65",
                sidebarCollapsed ? "justify-center px-3" : "px-5",
              )}
            >
              <Brand showLabel={!sidebarCollapsed} />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                aria-controls="desktop-sidebar"
                aria-expanded={!sidebarCollapsed}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                className="absolute right-[-0.875rem] top-[1.125rem] size-7 rounded-md bg-card"
              >
                {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </div>

            <nav
              aria-label="Primary navigation"
              className="flex flex-1 flex-col gap-1 p-3"
            >
              <p
                className={cn(
                  "px-3 pb-2 pt-2 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground",
                  sidebarCollapsed && "sr-only",
                )}
              >
                Workspace
              </p>
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={cn(
                      "group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
                      sidebarCollapsed && "justify-center px-0",
                      active && "bg-secondary text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[1.05rem] shrink-0",
                        active ? "text-primary" : "group-hover:text-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className={cn(sidebarCollapsed && "sr-only")}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border/65 p-3">
              <div
                className={cn(
                  "flex rounded-lg",
                  sidebarCollapsed
                    ? "flex-col items-center gap-2 py-1"
                    : "items-center justify-between px-2 py-1.5",
                )}
              >
                <div
                  className={cn(
                    "flex items-center",
                    !sidebarCollapsed && "gap-2.5",
                  )}
                >
                  <UserButton
                    afterSignOutUrl="/"
                    appearance={{
                      elements: { avatarBox: "size-8 rounded-lg" },
                    }}
                  />
                  {!sidebarCollapsed && (
                    <span className="text-xs font-medium text-muted-foreground">
                      Personal account
                    </span>
                  )}
                </div>
                <ThemeToggle />
              </div>
            </div>
          </aside>

          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/75 bg-background/95 px-4 backdrop-blur md:hidden">
            <Brand />
            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <UserButton
                afterSignOutUrl="/"
                appearance={{ elements: { avatarBox: "size-9 rounded-lg" } }}
              />
            </div>
          </header>

          <div
            className={cn(
              "transition-[padding-left] duration-200 ease-out motion-reduce:transition-none",
              sidebarCollapsed ? "md:pl-[4.5rem]" : "md:pl-52",
            )}
          >
            {children}
          </div>

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

function Brand({ showLabel = true }: { showLabel?: boolean }) {
  return (
    <Link
      href="/dashboard"
      aria-label="Investment Sync overview"
      className="flex min-w-0 items-center gap-2.5"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <WalletCards className="size-4" aria-hidden="true" />
      </span>
      {showLabel && (
        <span className="truncate text-sm font-semibold tracking-[-0.02em]">
          Investment Sync
        </span>
      )}
    </Link>
  );
}
