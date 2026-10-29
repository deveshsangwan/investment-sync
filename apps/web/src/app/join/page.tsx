"use client";

import { useEffect, useState } from "react";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@investment-sync/backend/api";
import { PageHeader, PageShell, Panel } from "../../components/portfolio-ui";
import { Button } from "../../components/ui/button";
import { ConvexSessionGate } from "../convex-provider";
import { useManagementOperation } from "../../features/households/use-management-operation";

export default function JoinPage() {
  const [token, setToken] = useState("");
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    setToken(
      new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "",
    );
  }, []);

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

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const accept = useMutation(api.households.acceptInvite);
  const operation = useManagementOperation();
  const [isAccepted, setAccepted] = useState(false);

  return (
    <div className="space-y-3">
      {isAccepted ? (
        <Button asChild>
          <Link href="/settings">Open household accounts</Link>
        </Button>
      ) : (
        <Button
          disabled={operation.isPending}
          onClick={() =>
            void operation.run(async () => {
              await accept({ token });
              window.history.replaceState(null, "", "/join");
              setAccepted(true);
              router.replace("/settings");
            }, "Invitation accepted. You can now view this household.")
          }
        >
          {operation.isPending
            ? "Accepting invitation…"
            : "Accept invitation as viewer"}
        </Button>
      )}
      <p role="status" className="text-sm">
        {operation.message}
      </p>
    </div>
  );
}
