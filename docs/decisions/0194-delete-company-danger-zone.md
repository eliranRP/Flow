# The owner deletes a company and all of its data from a danger zone, after typing its name

**Date:** 2026-10-19
**Status:** Accepted
**Amends:** [0095](0095-mcp-first.md) (an MCP tool is withheld on purpose for an action that cannot be undone, and the database enforces it)

## Context

The owner asked for a danger zone in Settings that lets a user remove all of their data. [0193](0193-client-privileges.md) took DELETE on `companies` away from clients and dropped the `companies_delete` policy, and said a confirmed action would replace it. Until now a company could not be deleted from the app or through REST.

What a company holds, checked in the catalog of a fresh database:

- **Foreign keys to `companies`.** 42 tables reference `companies(id)`, every one `on delete cascade`, in `public` and `private` (`mcp_credentials`, `loan_deletions`, `category_deletions`, `category_moves`). The rest of a company's rows hang off those: lines, allocations, splits, loan rates, forecast edits, Jev suggestions, `mcp_idempotency` through `mcp_credentials`.
- **A `company_id` with no foreign key to `companies`.** `private.mcp_writes`, `private.mcp_batches` and `private.mcp_sync_jobs` cascade through `mcp_credentials`; `jev_outcomes`, `jev_prefills` and `jev_line_failures` cascade through `transactions`.
- **No `company_id` at all.** `private.mcp_rate` counts flow-mcp requests per token or per user, with no foreign key. `private.mcp_auth_failures` is per address and `private.jev_run_lease` is one global row. `push_subscriptions` and `notification_prefs` belong to the user.
- **Secrets and files.** Vault holds only platform secrets (`cron_secret`, `flow_sync_url`, `jev_api_key`). SUMIT and Mercury keys are envelope-encrypted in `connector_connections`. No storage bucket exists: a line's documents are links in its row.
- **Triggers on the cascade.** The audit trigger and the category children guard already skip a company whose row is gone. `jev_outcome_sync` may run while lines go.

## Decision

- **The RPC.** `public.delete_company(p_company_id uuid, p_confirm text)`, `security definer` with `search_path = ''`, granted to `authenticated` only and on the `privilege_guards` allowlist. It resolves the company with `private.team_owner_company()`, as the team RPCs do: an editor or a viewer gets `forbidden` (42501), and a user with no company of their own gets `no company`. `p_company_id` must be that company, as in `rename_company`, so a stale header cannot point the delete at another company. `p_confirm`, trimmed as company names are (`private.trim_name`), must equal the company's name exactly, case included, or the call fails with `confirmation_mismatch` (22023) and nothing changes. A request whose JWT claims carry a flow-mcp token (`mcp_tid`, read the way `private.active_company()` reads it) gets `forbidden` (42501) before anything else. The company row is locked first.
- **What it deletes.** The company's flow-mcp rate counters (by its credentials' ids), then the company row, which cascades to every table above. Then the six tables with a `company_id` but no foreign key to `companies` are cleared by `company_id` once more, so a row whose token or line belongs elsewhere, or one a cascade trigger writes, cannot outlive the company. The audit rows go with the company, and the delete writes none.
- **What stays.** The auth user, who stays signed in. Their push subscriptions and notification preferences, which are per user and per device and serve their other companies. Their seats in other companies. Every other company. The user can then create a company, as setup does.
- **The app.** The business page (`/settings/business`, העסק) ends with a section אזור מסוכן ("danger zone") for the owner only, with one destructive row, מחיקת כל הנתונים ("delete all the data"). It opens a confirm sheet: what is deleted (every project, transaction, loan, connection and setting of the company, for everyone on the team) and that it cannot be undone, a field for the company's name, and מחיקה לצמיתות ("delete for good"), off until the typed name matches. A delete drops the company header, clears every cached read and opens `/setup/welcome`, which goes home when the user still belongs to another company. A refusal toasts, and the sheet stays open.
- **No MCP tool: this amends [0095](0095-mcp-first.md).** 0095 says every user action ships with a flow-mcp tool, and its only exception was layout or copy. This decision adds a second: an action that cannot be undone may withhold its tool on purpose, when the decision says so and the database refuses the action to a flow-mcp token. Every flow-mcp write has an undo, and this one cannot have one; a token is bound to the company it would delete, and an agent should never be able to wipe the books. `delete_company` is listed in [TOOLS.md](../mcp/TOOLS.md) as never a tool. The owner deletes a company in the app, by typing its name.

## Alternatives rejected

**Restore the REST delete and its policy.** A delete through REST has no confirmation, and it cannot clear the tables that have no foreign key to `companies` or the flow-mcp rate counters.

**Delete the user's account too.** The owner asked to remove the data, not to leave Flow. The user may edit or view other companies, and a new company is one step away.

**A soft delete with a grace period.** It keeps the data the user asked to remove, and every read would have to filter deleted companies. The typed name is the safety.

**Delete push subscriptions when the user has no company left.** They are the device's, not the company's, and the browser would still believe it is subscribed when the user creates the next company.

## Consequences

A company is deleted only by its owner, in the app. A new table that holds company data needs a foreign key to `companies` with `on delete cascade`, or a line in `delete_company`; the pgTAP test `delete_company.test.sql` sweeps every table in `public` and `private` with a `company_id` and fails when one keeps a row of the deleted company. The flow-mcp tool list does not change, and a token that calls the RPC directly is refused. The delete runs in one statement under `authenticated`'s 8-second statement timeout; a very large company (roughly 80,000 to 100,000 lines) could reach it. That is acceptable at today's sizes, and a follow-up task moves the work out of the request if it happens.
