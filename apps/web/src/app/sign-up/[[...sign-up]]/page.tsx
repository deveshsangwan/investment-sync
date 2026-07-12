import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthPageShell, authAppearance } from "@/components/auth-page-shell";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a private Investment Sync household portfolio.",
};

export default function SignUpPage() {
  return (
    <AuthPageShell
      eyebrow="Create your household view"
      title="Bring every account into context."
      description="Start with a supported export, review detected records, and keep Indian and US investments in one portfolio."
      securityDescription="Clerk manages account creation and session security."
    >
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/dashboard"
        signInForceRedirectUrl="/dashboard"
        appearance={authAppearance}
      />
    </AuthPageShell>
  );
}
