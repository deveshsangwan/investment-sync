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
      eyebrow="Investment Sync"
      title="Create your portfolio."
      description="Bring your Indian and US investments together. Start with a statement you already have."
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
