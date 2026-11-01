# Realized sales follow-up

Issue #52 now imports reconciled Vested sold lots and complete source snapshots, including valid empty reports. Position details retain reported results through partial sales, full liquidation, overlap and reentry. See [the statement contract and recovery requirements](realized-sales.md).

Remaining source and product limits:

- A sold symbol without a historical holding has retained sale facts but no holding-detail position. A separate transaction-history view could expose these without fabricating a snapshot.
- Identical lots in separate reporting subsets need stable source IDs to distinguish them. Untagged corrections that change financial identity need an explicit correction process.
- Old exports cannot restore complete empty boundaries that were never retained. Reprocessing an available original statement through the normal import workflow can capture that evidence.
- Reported native USD gains remain separate from today's INR valuation. Historical INR conversion and optional fee presentation require their own source-backed contracts; this implementation estimates neither.
- A report can omit sales outside its reporting window. Absence does not mean zero realized gain.

No production deployment, data rewrite or migration is authorized by this document.
