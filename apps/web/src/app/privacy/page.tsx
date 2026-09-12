import type { Metadata } from "next";
import {
  LegalArticle,
  LegalFooter,
  LegalHeader,
  LegalSection,
} from "@/components/legal-page-chrome";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Investment Sync handles authentication, portfolio records, and uploaded source files.",
};

export default function PrivacyPage() {
  return (
    <main id="main-content" className="min-h-[100dvh]">
      <LegalHeader />

      <LegalArticle
        title="Privacy"
        updatedAt="12 July 2026"
        summary="Investment Sync processes your account identity and the portfolio files you choose to upload. Access is scoped to your signed-in household, and original files expire after 30 days by default."
      >
        <LegalSection heading="Account identity">
          <p>
            Clerk handles authentication. Investment Sync stores the account
            email and household membership needed to authorize portfolio access.
          </p>
        </LegalSection>

        <LegalSection heading="Portfolio records">
          <p>
            Applied imports create normalized accounts, holdings, transactions,
            valuations, and import metadata. These records are what the
            portfolio views are built from.
          </p>
        </LegalSection>

        <LegalSection heading="Original files">
          <p>
            Uploaded source files are stored privately and retained for 30 days
            by default. Expired objects are removed during scheduled cleanup.
          </p>
        </LegalSection>

        <LegalSection heading="After a file expires">
          <p>
            The normalized records stay, so account history and portfolio views
            keep working. The imports list marks which source files are gone.
          </p>
        </LegalSection>

        <LegalSection heading="How the data is used">
          <ul className="list-disc space-y-2 pl-4">
            <li>Authenticate your session and identify the household.</li>
            <li>Parse, review, and apply supported portfolio exports.</li>
            <li>Calculate value, allocation, gains, and returns.</li>
            <li>Keep import status visible after a source file expires.</li>
          </ul>
        </LegalSection>

        <LegalSection heading="Service providers">
          <p>
            Clerk provides authentication. Supabase provides the database and
            the private file storage this application uses.
          </p>
        </LegalSection>

        <LegalSection heading="Controls in this build">
          <p>
            You can review imports and connected accounts inside the app. This
            build does not offer a self-service portfolio deletion action.
          </p>
        </LegalSection>
      </LegalArticle>

      <LegalFooter current="privacy" />
    </main>
  );
}
