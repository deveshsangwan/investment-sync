import {
  PageHeader,
  PageShell,
  PortfolioContentSkeleton,
} from "@/components/portfolio-ui";

export default function Loading() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Private portfolio"
        title="Loading your portfolio"
        description="Preparing the latest committed view."
      />
      <PortfolioContentSkeleton />
    </PageShell>
  );
}
