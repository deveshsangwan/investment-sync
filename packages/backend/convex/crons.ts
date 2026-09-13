import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "Clean obsolete portfolio projections",
  { hours: 6 },
  internal.publicationCleanup.sweep,
  { cursor: null },
);
crons.interval(
  "Expire failed staging",
  { hours: 1 },
  internal.importCleanup.expireFailedStaging,
  {},
);
crons.interval(
  "Expire source files",
  { hours: 1 },
  internal.importCleanup.expireFiles,
  {},
);
crons.interval(
  "Expire parse leases",
  { minutes: 5 },
  internal.importCleanup.expireParseLeases,
  {},
);
crons.interval(
  "Sweep abandoned storage",
  { hours: 6 },
  internal.importCleanup.sweepOrphans,
  { cursor: null },
);
crons.interval(
  "Refresh USD INR rate",
  { hours: 6 },
  internal.actions.refreshCurrencyRate.refreshCurrencyRate,
  {},
);
export default crons;
