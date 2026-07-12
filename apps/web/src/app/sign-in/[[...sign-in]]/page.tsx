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
      title="Return to the complete picture."
      description="Pick up with the latest portfolio data, import history, and account context already in place."
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
