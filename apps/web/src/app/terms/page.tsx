import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalArticle,
  LegalFooter,
  LegalHeader,
  LegalSection,
} from "@/components/legal-page-chrome";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Investment Sync.",
};

export default function TermsPage() {
  return (
    <main id="main-content" className="min-h-[100dvh]">
      <LegalHeader />

      <LegalArticle
        title="Terms"
        updatedAt="12 July 2026"
        summary="Investment Sync organizes portfolio records you provide. Using it means using it lawfully, and checking portfolio information before you rely on it."
      >
        <LegalSection heading="What this is">
          <p>
            A private portfolio organization tool. It combines statements you
            upload into household views, calculations, and import history.
          </p>
        </LegalSection>

        <LegalSection heading="Your account">
          <p>
            Keep your sign-in method secure. Use the service only for portfolio
            data you are authorized to access and upload.
          </p>
        </LegalSection>

        <LegalSection heading="Your imports">
          <p>
            You are responsible for reviewing detected rows, warnings, dates,
            currencies, and totals before applying an import. Nothing is applied
            to the portfolio until you choose to apply it.
          </p>
        </LegalSection>

        <LegalSection heading="Calculations">
          <p>
            Values and returns depend on the source data, the cash flows
            available, exchange rates, and calculation assumptions. They can be
            incomplete or out of date, and the interface labels which is which.
          </p>
        </LegalSection>

        <LegalSection heading="Not investment advice">
          <p>
            Investment Sync does not recommend securities, provide tax or legal
            advice, or replace a qualified professional.
          </p>
        </LegalSection>

        <LegalSection heading="Availability">
          <p>
            The application and its supported import formats can change. Keep
            copies of the source records you need outside the service.
          </p>
        </LegalSection>

        <LegalSection heading="Privacy">
          <p>
            The{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              privacy page
            </Link>{" "}
            explains authentication, portfolio records, and the 30-day default
            retention period for original upload files.
          </p>
        </LegalSection>
      </LegalArticle>

      <LegalFooter current="terms" />
    </main>
  );
}
