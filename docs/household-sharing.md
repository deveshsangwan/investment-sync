# Household sharing and account management

The web app uses `packages/backend/convex`. The retained PostgreSQL/mobile APIs are unchanged.

An owner creates a viewer invitation in Accounts and shares the generated link themselves. No email is sent. Tokens use 32 random bytes generated in a Node action, travel in the URL fragment, and are stored only as SHA-256 hashes. The database transaction checks the authenticated verified email, pending status, and seven-day expiry before consuming a token. Revocation, replacement, and consumption invalidate the link. Invalid links reveal no household metadata.

Acceptance retains the invitee's existing household memberships and financial data, then selects the invited household. Accounts offers an explicit household switcher. Legacy users with one membership need no backfill; their existing membership remains the default. New current-household fields are optional. Multiple legacy memberships without an explicit selection still fail closed, as before, rather than silently choosing a portfolio.

Owners can remove viewers. Removal preserves financial history, revokes pending invitations for their recorded email, and moves the removed user's selected household to another membership or a new empty personal household. An owner cannot remove themselves. Ownership transfers to an active viewer in one transaction, demotes the previous owner, and revokes outstanding invitations. The UI requires the word `TRANSFER`. Transfers are rejected while an import publication is running. Membership events record household, actor, target, action, and timestamp without raw tokens. Owners can read the latest 50 events through `households.auditEvents`.

Households support at most 32 active members, users at most 32 household memberships, and households at most 64 pending invitation records. Creation cleans up expired pending records. Expiry is always enforced at redemption, even if an open Settings page still lists the old record with its expiry date.

## Clerk signed email prerequisite

Invitation redemption needs the authenticated identity's `email` and boolean `emailVerified`. Stored profile email and client form values are not proof of verification. Missing claims fail closed with a message directing the user to verify their email and contact the administrator if needed.

The existing integration uses native Clerk session tokens. In Clerk's session token claims editor, preserve the existing `aud` claim and map `email` to the primary email and `email_verified` to the primary email's verification state using Clerk's supported user shortcodes. Never set verification to a hardcoded `true`, and never map it to writable user metadata. Check the claim editor preview for both verified and unverified synthetic users, including boolean type. Convex normalizes the standard `email_verified` JWT claim to `identity.emailVerified`. Existing session tokens must refresh after claim changes.

See [Clerk's additional-claims setup](https://clerk.com/docs/guides/development/integrations/databases/convex#map-additional-claims-optional) and [session token customization](https://clerk.com/docs/guides/sessions/customize-session-tokens). This implementation did not inspect or change any live Clerk configuration. Confirm these signed claims with a fake development identity before enabling invitation redemption in a deployment. No additional service or backend credential is needed.

## Account history and source rules

Renaming sets an optional display name. Import identity, account keys, provider, immutable source rows, and recovery data remain unchanged, so later imports still match the account.

Archived accounts remain in Accounts with an Unarchive action, and disappear immediately from the default account list, holdings, dashboard totals, account-attributable performance, and details. Unarchive restores the existing history. Archival filters the already selected published positions, after overlap and complete-snapshot omission rules have run. It does not revive an older overlapping source. Resolved transaction occurrence IDs are retained.

Reported portfolio-level valuations cannot be split by account. While any account is archived, charts use visible holding history instead of unscoped reported totals. This is explained in Accounts. Archived reads decode the bounded active-version projection; the normal indexed read path remains in use when no account is archived. This costs more reads for archived portfolios and remains subject to existing portfolio capacity limits. No unpublished source facts participate in these reads.

All management mutations respect the migration write freeze. Migration, reconciliation, rollback, and source retention tooling remain available. There is no deployment or production operation in this change.

## Integrated rollout notes

This branch includes the account-aware identity/history/cashflow/alias correction from #66 and the incremental exact-total selector from #67. Archival filters selected contributions without returning to the earlier full-selection implementation. Missing P&L continues to be derived for totals/read-time summaries under #68 while the original source field remains unchanged. For older materialized selections, #66 still requires the next successful publication to reflect its corrected selection behavior; no manual production publication was performed for this change.

The queue validation uses a fake signed issuer and disposable Convex/PostgreSQL services. It does not verify hosted Clerk settings. Missing or unverified signed email claims remain fail-closed. Confirm the documented claim configuration before enabling redemption in a live deployment.
