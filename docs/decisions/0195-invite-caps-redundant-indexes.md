# Invites are capped per company and per user per day, and twelve redundant indexes go

**Date:** 2026-10-19
**Status:** Accepted

## Context

A Supabase advisors review flagged two things.

- **No limit on invites.** `invite_member` only refused more than 50 pending invites in a company. An owner, or a flow-mcp token with `write`, could invite, cancel and invite again without end, and each new invite in the app triggers an email through the `invite-email` edge function. That function mails any pending invite of the caller's company on request, as often as it is called; Resend's idempotency key only folds repeats within 24 hours. That makes Flow a way to send email to any address, an abuse and spam risk for the sending domain.
- **Unused indexes.** The performance advisor lists indexes with no scans. The owner asked not to drop them blindly. Twelve looked redundant because another index on the same table starts with the same column or columns.

What the catalog showed, the same in a fresh local database and in production:

- Every foreign key on these tables is a composite `(company_id, …)` key, including the four loan category keys (`(company_id, escrow_category_id)` and so on, `on delete set null (<column>)`), `loans (company_id, project_id)` and `split_rules (company_id, supplier_id)`. Each has its own `(company_id, <column>)` index, so a cascade or a key check from the parent finds the rows by index without the single-column ones.
- Every read of `loans` or `split_rules` in a function, the app or flow-mcp filters by `company_id` (RLS adds it to REST reads anyway); none looks a row up by a category, project or supplier id alone.
- None of the twelve had a production index scan since the statistics were last reset.

## Decision

**Invite caps, in the database.**

- `invite_member` creates at most **10 new invites per company** and **20 per inviting user** (across every company they own, now or before) in any rolling 24 hours. Over either cap it raises `invite_limit` (SQLSTATE 23514) and writes nothing.
- The company count reads `company_invites.created_at` whatever the invite's status now, so a cancelled invite still counts and cancel-and-invite cannot loop.
- The user count reads `private.invite_sends`, a ledger of one row (`user_id`, `created_at`) per counted invite. It has no company key, so `delete_company` ([0194](0194-delete-company-danger-zone.md)) does not clear it: create a company, invite, delete it and create another, and the user's count carries on. A new company starts its own company count; the ledger bounds the loop. `invite_member` deletes the user's ledger rows older than 2 days as it goes. The table has RLS on, no policy and no client grant, like every `private` table ([0193](0193-client-privileges.md)), and its rows go with the auth user.
- Both counts are exact: `invite_member` takes a per-user advisory lock and then the existing per-company one, always in that order, before it counts. Inviting an email that already has a pending invite returns that invite, sends no email, and is not counted. The 50-pending check stays and runs first.
- The numbers: a small business adds a few people at a time; 10 a day per company covers a whole team on day one, and 20 per user leaves room for an owner setting up two companies. A spammer gets 10 addresses a day from a company, against unlimited before.
- `claim_invite_email(p_invite_id)` is the edge function's claim on one send: the caller owns the company (`private.team_owner_company()`), the invite is pending and not expired, and it has had fewer than **3 emails** (`company_invites.email_sends`, with `emailed_at`). Otherwise it raises `invite not found`, or `invite_email_limit` (23514) past the third. The function claims before it calls Resend and answers 429 `email_limit` or 404. Three, not one, so a send that failed can be tried again. Emails a day are therefore at most three times the invite caps.
- `company_invites (company_id, created_at)` is indexed for the company count; it also gives `company_invites_company_id_fkey` a whole index for the first time.
- The app shows `invite_limit` as a failure toast without a retry: שלחתם היום את מספר ההזמנות המרבי. נסו שוב מחר. ("you sent the most invites for today; try again tomorrow"). flow-mcp's `invite_member` answers `refused` / `invite_limit` (`private.mcp_refused` names it).

**Indexes.** These twelve are dropped, each beside the index that serves the same lookups:

| Dropped | Kept, leading with the same columns |
| --- | --- |
| `invoice_match_dismissals_company_idx` | `invoice_match_dismissals_bank_idx` and `…_company_transaction_idx` |
| `invoice_paid_marks_company_idx` | `invoice_paid_marks_company_id_transaction_id_fk_idx` |
| `invoice_payment_links_company_idx` | `invoice_payment_links_company_id_bank_transaction_id_key` |
| `jev_line_failures_company_idx` | `jev_line_failures_company_id_transaction_id_fk_idx` |
| `overhead_company_idx` | `overhead_company_id_transaction_id_fk_idx` |
| `split_rule_targets_company_idx` | `split_rule_targets_company_id_project_id_fk_idx` |
| `split_rules_company_idx` | `split_rules_company_id_id_key` |
| `split_rules_supplier_idx` | `split_rules_company_id_supplier_id_fk_idx` (the key is `(company_id, supplier_id)`) |
| `loans_project_idx` | `loans_company_id_project_id_fk_idx` |
| `loans_escrow_category_idx` | `loans_company_id_escrow_category_id_fk_idx` |
| `loans_fees_category_idx` | `loans_company_id_fees_category_id_fk_idx` |
| `loans_principal_category_idx` | `loans_company_id_principal_category_id_fk_idx` |

The pgTAP guard `foreign_key_indexes.test.sql` now asks for a valid index that leads with each key's columns and is either whole or partial on one of those columns being not null (the only partial index a key lookup can use), and checks the twelve stay dropped. Three foreign keys known before this change are covered only by a partial index on another condition and stay listed as exceptions: `connector_refresh_requests.company_id`, `private.mcp_credentials.user_id` and `private.mcp_writes.user_id`.

## Alternatives rejected

**Cap only in the edge function.** The function is one caller; flow-mcp and any client can call `invite_member` directly, and an edge counter needs storage the database already has.

**Count the user cap from `company_invites.invited_by`.** Those rows cascade with the company, so deleting a company would reset its owner's count.

**Calendar-day caps.** A rolling 24 hours needs no time zone and cannot be doubled at midnight.

**One email per invite, ever.** A send that fails at the provider could then never be tried again; three keeps a retry and still bounds the total.

**Also drop `loans_interest_category_idx` and `split_rule_targets_project_idx`.** They have the same shape, but production shows a few scans on each, so they wait for evidence.

## Consequences

An owner who invites an eleventh person in a day sees the toast and tries the next day; nothing is saved. Deleting the company does not give the owner more invites that day. A test that creates many invites inside a day must age them (in `company_invites` and `private.invite_sends`) or stay under the caps. The invite-email function makes one more RPC per send. A new foreign key needs a whole index (or one partial on its column being not null), or the guard fails.
