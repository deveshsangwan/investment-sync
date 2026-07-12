"use client";

import { ErrorState, PageShell } from "@/components/portfolio-ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageShell className="grid min-h-[70dvh] place-items-center">
      <div className="w-full max-w-2xl">
        <ErrorState
          title="This page couldn't be loaded"
          description="Try the request again. Your saved portfolio and imports have not changed."
          onRetry={reset}
        />
      </div>
    </PageShell>
  );
}
