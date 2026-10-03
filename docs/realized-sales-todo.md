# TODO: realized sales and accurate exited-position gains

Status: deferred product work, outside the current Convex migration scope.

Recorded at the owner's request on 2026-09-14. This TODO does not authorize implementation or change the migration's legacy-parity requirements.

## Problem

The current Vested parser imports only the workbook's Unrealized P&L - Summary sheet. Exited positions can be inferred when an older holding disappears from a later snapshot. The gain or loss displayed for that position comes from its last holdings snapshot.

That snapshot can be weeks or months before the sale. It does not establish the execution price, sale date, proceeds, or realized gain. For example, ten shares bought at $10 and last observed at $12 could later sell at $15. The earlier snapshot shows a $20 unrealized gain, while the sale realizes $50 before fees. Disappearance alone cannot determine that result. Price movements after the sale must not change its realized gain.

## Future work

- [ ] Import Vested realized-sales summaries and sold-lot breakdowns, retaining sale dates, quantities, proceeds, cost basis, reported gains/losses, currencies, and available fees.
- [ ] Preserve acquisition-lot details where needed to explain the broker's cost basis and remaining holdings. Decide how to handle missing cost basis and report corrections before implementation; do not invent values.
- [ ] Keep partial sales in Current at the remaining quantity, with realized gains for the sold portion shown separately from unrealized gains on the remaining portion.
- [ ] Show fully sold positions with their actual sale results. Distinguish confirmed sales from positions merely absent from a later snapshot.
- [ ] Deduplicate sales across repeated and overlapping report periods without collapsing distinct fills. Handle later corrections and purchases after a full exit.
- [ ] Retain source provenance and native-currency amounts. Define historical INR conversion explicitly so refreshing today's FX rate does not silently rewrite reported realized results.
- [ ] Make report coverage and missing sale history visible. A later report may omit sales outside its reporting window; absence must not imply a zero gain or an invented sale.

## Acceptance checks

- [ ] Reconcile imported sales and totals against the workbook's realized-summary and breakdown sheets without counting both twice.
- [ ] Cover a sale between widely spaced snapshots, partial exits, full exits, re-entry, and distinct same-day fills.
- [ ] Prove repeated and overlapping imports do not duplicate realized gains.
- [ ] Keep realized gains and current unrealized gains separate in position details and portfolio totals.
- [ ] Use generated regression fixtures; keep personal statements and financial records outside Git.

The existing Current/Exited behavior, including overlapping source groups, remains unchanged during migration. This capability requires a separate design, implementation, and review.
