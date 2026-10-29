"use client";

import { useSyncExternalStore } from "react";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { PageHeader, PageShell, Panel } from "../../components/portfolio-ui";
import { Button } from "../../components/ui/button";
import { ConvexSessionGate } from "../convex-provider";
import { AcceptInvitation } from "../../features/households/accept-invitation";

export default function JoinPage() {
  const token = useSyncExternalStore(
    subscribeToInvitationChanges,
    readInvitationToken,
    () => "",
  );
  const { isLoaded, isSignedIn } = useAuth();

  const returnUrl = `/join#invite=${encodeURIComponent(token)}`;

  return (
    <PageShell>
      <PageHeader
        title="Join a household"
        description="Accept a private invitation to view a shared portfolio."
      />
      <Panel title="Household invitation">
        <p className="mb-4 text-sm">
          Sign in with the verified email the owner invited. Joining keeps your
          existing household and portfolio separate. You can switch households
          in Accounts.
        </p>
        {!token ? (
          <p role="status">
            Open the full invitation link shared by the owner.
          </p>
        ) : !isLoaded ? (
          <p role="status">Loading sign-in…</p>
        ) : !isSignedIn ? (
          <div className="flex gap-3">
            <SignInButton forceRedirectUrl={returnUrl}>
              <Button>Sign in to accept</Button>
            </SignInButton>
            <SignUpButton forceRedirectUrl={returnUrl}>
              <Button variant="outline">Create account</Button>
            </SignUpButton>
          </div>
        ) : (
          <ConvexSessionGate loading={<p>Preparing your account…</p>}>
            <AcceptInvitation token={token} />
          </ConvexSessionGate>
        )}
      </Panel>
    </PageShell>
  );
}

function readInvitationToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "";
}

function subscribeToInvitationChanges(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);

  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}
