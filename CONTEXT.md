# Investment Sync

Investment Sync turns household portfolio source files into normalized records and derived portfolio views.

## Import language

**Household**:
The ownership boundary for portfolio data and Import Batches shared by its members.
_Avoid_: Account, user

**Import Batch**:
The record of one Source File and its Normalized Rows as they move through validation and Commit.
_Avoid_: Import, upload

**Source File**:
The original portfolio export supplied by a user. Its retention and availability are independent of the Import Batch workflow state.
_Avoid_: Import

**Normalized Row**:
A validated holding, transaction, or valuation produced from a Source File by a versioned parser.
_Avoid_: Raw row

**Commit**:
The atomic application of every Normalized Row in a parsed Import Batch to Household portfolio data.
_Avoid_: Apply, process

**Duplicate Import**:
A different Import Batch in the same Household with the same Source File content and parser version as an already committed batch.
_Avoid_: Retry
