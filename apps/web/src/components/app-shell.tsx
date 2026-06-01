"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import { BarChart3, Settings, UploadCloud, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/uploads", label: "Uploads", icon: UploadCloud },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <SignedIn>
        <header className="sticky top-0 z-40 border-b bg-background/82 backdrop-blur-xl">
          <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
                <WalletCards className="size-4" />
              </span>
              <span className="hidden text-sm font-bold tracking-normal sm:inline">
                Investment Sync
              </span>
            </Link>

            <nav className="flex items-center gap-1 rounded-lg border bg-card/70 p-1 shadow-sm">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      isActive && "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </header>
      </SignedIn>
      {children}
    </div>
  );
}
