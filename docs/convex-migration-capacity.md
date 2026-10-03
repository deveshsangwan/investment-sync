# Convex migration capacity evidence

Generated from protected inventory run `phase0-20260829-verified`. This file contains sanitized aggregates only.

## Phase 0 status

Production evidence passed compatibility and reconciliation gates. Candidate application ceilings are set below. Phase 3 still validates them against real Convex runtime limits.

## Postgres counts

| Table                | Records |
| -------------------- | ------: |
| users                |       2 |
| households           |       2 |
| household_members    |       2 |
| accounts             |      19 |
| instruments          |      93 |
| import_batches       |      16 |
| import_rows          |    1367 |
| transactions         |       0 |
| holding_snapshots    |     655 |
| prices               |       0 |
| portfolio_valuations |      14 |
| currency_rates       |       1 |

## Coherent largest persisted-batch profile

Source: investment_portfolio_xlsx. 674 rows, 336090 normalized UTF-8 JSON bytes, 8 distinct accounts, and 91 distinct instruments. Row kinds: holding=660, valuation=14. Currencies: INR=611, USD=63. Projected fact writes are at least 674; projected read-model writes are at least 116. These are lower bounds until the full publication module exists.

Largest-Household state: 13 accounts, 87 instruments, 16 Import Batches, 1367 normalized rows, 655 holding snapshots, 0 transactions, 14 valuations, and 669 total persisted fact rows.

Storage correlation: 4 referenced files are available, 0 are missing, and 1 unreferenced bucket object exists.

## Reconciliation and pending decisions

Unresolved blocking findings: none.

Recorded sanitized dispositions: `batch_row_count_mismatch` as `persisted_rows_authoritative`, `pending_empty_expired_batches` as `preserve_empty_history`, `storage_orphan_bucket_objects` as `exclude_unlinked_object`.

Pending batches: 8 meaningful expired, 4 empty expired, and 0 in other pending groups. Preserve 8 meaningful expired batches with their persisted rows. Preserve empty expired batch history as unavailable with the approved typed target reason; do not invent rows.

Prices: no records observed; removal still waits for consumer verification.

## Candidate ceilings

262144 compressed bytes, 1100 normalized rows, and 524288 normalized UTF-8 JSON bytes. Each axis uses its applicable observed maximum plus 50 percent, rounded up to 256 KiB, 100 rows, and 64 KiB; compressed bytes are also bounded by the current 4 MiB application limit.

The compressed ceiling uses the largest available parsed Source File (11888 bytes) independently from the persisted-batch profile. The largest persisted batch's Source File is past retention, so a coherent compressed measurement does not exist.

The current 4 MiB and 25,000-row checks are legacy implementation limits. They do not override these evidence gates.

## Twice-largest synthetic fixture

Publication fixture: use source type investment_portfolio_xlsx. Generate exactly 1348 rows and at least 672180 normalized UTF-8 JSON bytes. Preserve 16 distinct accounts, 182 distinct instruments, row kinds holding=1320, valuation=28, and currencies INR=1222, USD=126. Expected writes are lower bounds: at least 1348 facts and 232 read-model documents. Upload-transport fixture: generate a supported file of at least 23776 bytes. The fixtures test independent observed axes and must not be represented as one coherent production file.

Use obviously fake identities and amounts. Phase 3 runs this fixture on a real Convex development deployment and records reads, writes, bytes, duration, and failures. If the simple Commit path lacks the required headroom, use the staged builder fallback.
