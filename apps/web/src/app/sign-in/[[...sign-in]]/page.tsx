import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthPageShell, authAppearance } from "@/components/auth-page-shell";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your private Investment Sync portfolio.",
};

export default function SignInPage() {
  return (
    <AuthPageShell
      eyebrow="Welcome back"
      title="Sign in to your portfolio."
      description="Your holdings, statements, and accounts are waiting here."
      securityDescription="Clerk manages the sign-in flow and session security."
    >
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
        forceRedirectUrl="/dashboard"
        signUpForceRedirectUrl="/dashboard"
        appearance={authAppearance}
      />
    </AuthPageShell>
  );
}
