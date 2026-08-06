import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "./providers";
import { AppShell } from "@/components/app-shell";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Investment Sync",
    template: "%s | Investment Sync",
  },
  description:
    "A private household portfolio view for Indian and US investments.",
  applicationName: "Investment Sync",
  openGraph: {
    title: "Investment Sync",
    description:
      "A private household portfolio view for Indian and US investments.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable}`}
        suppressHydrationWarning
      >
        <body className="antialiased">
          <TRPCProvider>
            <AppShell>{children}</AppShell>
          </TRPCProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
