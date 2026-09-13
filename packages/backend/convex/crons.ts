import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
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
export default crons;
