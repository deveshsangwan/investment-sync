import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import { TRPCProvider } from "./providers";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: {
    default: "Investment Sync",
    template: "%s | Investment Sync",
  },
  description:
    "A private household portfolio view for Indian and US investments.",
  applicationName: "Investment Sync",
  icons: { icon: "/brand/quiet.png", apple: "/brand/quiet.png" },
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
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <html lang="en" suppressHydrationWarning>
        <body className="antialiased">
          <TRPCProvider>
            <AppShell>{children}</AppShell>
          </TRPCProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
