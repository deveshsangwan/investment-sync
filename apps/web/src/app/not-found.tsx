import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageShell } from "@/components/portfolio-ui";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell className="grid min-h-[70dvh] place-items-center">
      <div className="w-full max-w-2xl">
        <EmptyState
          icon={SearchX}
          title="This page isn't in the portfolio"
          description="The link may be outdated, or the item may have been replaced by a newer import."
          action={
            <Button asChild variant="secondary">
              <Link href="/dashboard">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to overview
              </Link>
            </Button>
          }
        />
      </div>
    </PageShell>
  );
}
