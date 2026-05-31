import { ClerkProvider, SignedIn, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { TRPCProvider } from "./providers";

export const metadata: Metadata = {
  title: "Investment Sync",
  description: "Private investment portfolio tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <TRPCProvider>
            <div className="shell">
              <SignedIn>
                <header className="topbar">
                  <Link href="/dashboard" className="brand">
                    Investment Sync
                  </Link>
                  <nav className="nav">
                    <Link href="/dashboard">Dashboard</Link>
                    <Link href="/uploads">Uploads</Link>
                    <Link href="/settings">Settings</Link>
                    <UserButton afterSignOutUrl="/" />
                  </nav>
                </header>
              </SignedIn>
              {children}
            </div>
          </TRPCProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
