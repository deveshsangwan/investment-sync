import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import { TRPCProvider } from "./providers";
import { AppShell } from "@/components/app-shell";

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
      <html lang="en" suppressHydrationWarning>
        <body>
          <TRPCProvider>
            <AppShell>{children}</AppShell>
          </TRPCProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
