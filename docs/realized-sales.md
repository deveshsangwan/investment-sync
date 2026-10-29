# Vested realized sales

Issue #52 adds realized acquisition lots to the active Convex web backend and shared portfolio domain. The Vested parser is `vested-drivewealth-v2`, with the existing `-decimal-v1` suffix on exact imports. Reprocess a retained workbook through the normal import workflow to add sales missing from v1. No deployment or production reprocessing is part of this change.

## Statement contract

The parser continues to read the Unrealized P&L - Summary sheet for holding snapshots. It also reads Realized P&L - Breakdown and reconciles Realized P&L - Summary. Sheet names tolerate trailing whitespace. Tests generate fake XLSX files; no personal statements or screenshot adjustments are used.

The breakdown requires Security or Symbol, a sale date, Quantity, reported USD proceeds, Cost Basis (USD), and Profit/Loss (USD). It accepts explicit aliases listed in `packages/importers/src/vested-sales.ts`, including Sell Date, Buy Date, Sell Value (USD), Buy Value (USD), and Realized P&L (USD). Acquisition dates, execution IDs and lot IDs are retained when supplied. An invalid supplied date or required realized amount fails parsing. Unknown populated layouts fail rather than silently dropping reported sales. Unrealized validation belongs to #59 and is unchanged here.

Each breakdown row becomes one sell transaction with its reported proceeds and quantity. Canonical decimal strings for cost basis, realized P&L and acquisition details live in validated `metadata.realizedSale`. Exact imports retain source precision for proceeds and quantities too. The summary never creates transactions. Per-security quantities reconcile within 0.0000000001 units and amounts within USD 0.01 to allow report rounding. Any provided grand total is checked separately. Nonzero summary-only activity fails. An absent realized sheet remains compatible; a breakdown without a summary imports with a reconciliation warning.

No commissions, cost-basis corrections or fees are estimated. The UI shows reported USD results without applying today's INR conversion. Sale-only activity is excluded from XIRR inputs because a realized report does not supply complete purchase cashflows.

## Identity and visibility

Sales attach to details by account plus instrument within the authenticated household. Existing complete holding snapshots still determine current and exited status. A partial sale does not cause an exit, and reentry retains earlier lots. Web details show sale and acquisition dates, quantity, proceeds, cost basis, reported gain or loss, and available execution/lot IDs. Exited holding values are labelled as the last observed snapshot; they are never relabelled as proceeds.

When execution IDs are available, sale date plus execution and lot ID identify a lot. Acquisition date is the fallback lot identifier. Without an execution ID, identity includes sale date, acquisition date, quantity, proceeds, reported basis and gain, plus the within-report occurrence count. Repeated and overlapping reports retain the maximum observed multiplicity rather than summing repeated rows. Parser version and reporting period are not sale identities. Corrections with stable execution/lot IDs replace projected values while immutable input facts remain retained.

Some source ambiguity remains. Identical rows in separate reporting subsets cannot be distinguished without stable source IDs. Corrections without stable execution IDs cannot safely be matched to their previous financial values. Changing IDs, sale dates or lot grouping requires an explicit correction process; imports do not guess that unrelated rows are replacements.

The existing snapshot model has two limits: an entirely empty holdings report cannot establish a new complete snapshot boundary, and a sold symbol with no historical holding snapshot has no holding-detail position. Its sale facts remain retained. Sales alone do not manufacture an exit or holding snapshot. The full-exit integration test uses a later complete snapshot containing another surviving holding.

Cross-account canonical position selection remains owned by #15. This change scopes sale attachment correctly but does not fix which account's holding is selected when that existing identity bug applies. No changes for #60 are included.

## Retained SQL and recovery

The SQL importer stores the same sale metadata. Migration `0012_realized_sale_identity` extends the transaction unique index with the realized lot occurrence identity and removes proceeds from identity for tagged sales. Existing transactions keep the old financial identity. The SQL upsert updates corrected execution-lot proceeds, quantity and metadata. SQL portfolio calculations also exclude partial realized reports from XIRR.

Apply the migration before using the retained SQL writer or replaying realized activity into SQL. This is a code requirement, not authorization to operate a database. Reverse replay retains separate lot occurrences and updates stable execution-lot corrections. No table columns or archived SQL snapshot formats change. Legacy SQL numeric columns retain their existing scales; the active exact Convex path preserves source decimal precision.

Offline regression coverage includes parser reconciliation and invalid input, partial sales, full exits, reentry, repeated/overlapping reports, parser-version reprocessing, equal-proceeds distinct sales, identical-lot multiplicity, execution corrections, concurrent independent household imports, account boundaries, household isolation and reverse replay. SQL integration tests include concurrent overlapping imports but require an accessible test PostgreSQL server. Browser and native testing are separate from these offline tests.
