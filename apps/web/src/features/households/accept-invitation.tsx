"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@investment-sync/backend/api";
import { Button } from "../../components/ui/button";
import { useManagementOperation } from "./use-management-operation";

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
