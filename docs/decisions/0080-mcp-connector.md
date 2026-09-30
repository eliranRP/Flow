# An MCP connector tags the ledger; the app stays the display

**Date:** 2026-09-30
**Status:** Proposed

Open questions remain at the end of this record, so it is not Accepted yet. The owner choices below are recorded so a reversal is a change to this record.

## Context

The owner wants an AI assistant to tag projects, work through pending expenses, and assign expenses to projects and categories, including splits. Moving an existing ledger through that work should be fast. The app remains the place the owner looks at the books.

Every capability the app has today keeps working unchanged, except the additive cases this record names. The connector calls the RPCs the app already calls. It does not grow a second assignment implementation.

Tool names, cycles, JSON shapes, and examples are in [MCP tools](../mcp/TOOLS.md). `tools/list` is built only from handlers that exist in that deploy. A tool whose cycle has not shipped is not listed.

## Decision

### Transport

The connector is a Supabase Edge Function, `flow-mcp`, speaking MCP streamable HTTP, protocol `2025-03-26`, stateless: one JSON-RPC message per request, no `Mcp-Session-Id`. The first cycles implement `initialize`, `tools/list`, and `tools/call`. `supabase/config.toml` sets `verify_jwt = false` for this function. The bearer is the MCP secret, not a Supabase user JWT, so the gateway must not reject it.

### Auth

The function does not store or refresh the app's refresh token. The app and the assistant do not share a GoTrue session. A second stored refresh token was rejected: Google sign-in has no first-party way to mint one, and a stored refresh token is the credential this record is refusing.

Each accepted call signs a new JWT for that user and throws it away. Claims are `sub` (the owner), `role` `authenticated`, `aud` `authenticated`, `iat` now, and `exp` 60 seconds later. The signature key is `SUPABASE_JWT_SECRET`. Ledger calls use the anon key and that JWT. `auth.uid()` is the owner for those 60 seconds.

The service role is used only to read and update `private.mcp_credentials` and the rate-limit rows. The function drops that client before any ledger call. A tool handler that receives the service role is a bug.

Scopes are `read` and `write`, stored on the credential and checked in the function before the JWT is signed. A read tool requires `read`. A write tool requires `write`. A miss is a tool result `forbidden`, not an HTTP 401. Cycle 2 mints both scopes for the one owner. The check still runs on every call, so a later read-only token works without a new function.

Minting is the Settings row in cycle 2, not a side path. The signed-in app calls `public.create_mcp_token`. That RPC is `security definer`. It checks `auth.uid()`, writes `private.mcp_credentials`, and returns the secret once. The edge function never sees the app's access token or refresh token. Revoke and list are the same kind of RPC. `private` is not exposed through PostgREST.

### Company isolation

The write RPCs the tools call are `security definer`. Row level security on the tables does not, by itself, isolate those bodies. Isolation is `private.current_company_id()` and the `auth.uid()` checks inside each function. The short-lived JWT is what makes `auth.uid()` the owner. A tool must not pass a company id. `get_dashboard` resolves the company from `auth.uid()`. The tools do not call `company_pnl` with an id the model supplied.

Each write function gets a pgTAP test in the cycle that adds it: a second company calls it with the first company's ids, the call is refused, and the first company's rows are unchanged.

### Owner choices

1. `approve_review` is the owner's confirmation under [0006](0006-confirm-not-type.md). The connector runs as the owner, at the owner's request. This amends [0006](0006-confirm-not-type.md) and [0011](0011-auto-approve-high-confidence.md). Only `approve_review` closes a review item, plus `skip_review`, which is דלג. `assign_expense` and `set_expense_category` on a row with an open review write a suggestion. `user_assigned` stays false, `category_suggested` is set true, and `project_suggested` stays the existing expression, so the card remains in לאישור with הצעה and אישור stays one tap. The same two tools on a row with no open review are a real assignment, because there is no card left to confirm. `split_expense` and `collapse_expense` also leave an open review open.
2. `resolve_review` and `approve_split_review` on an item that is not open return without writing and without raising. The app drops a card that the next `list_review` no longer contains, with no error toast. A local skip or approve still advances `{i} מתוך {n}` for the visit, as in [0069](0069-back-and-one-tap-review.md) point 8. A remote shrink keeps `i` and shrinks `n`. If the current card was closed remotely, the next card is shown at the same `i`. If none remains, the screen is the existing empty state, "הכל מאושר". The tab badge is the open-queue count from the latest fetch.
3. Refresh. Cycle 2 refetches, on focus and when the document becomes visible, the keys the approve path already uses: `review`, `dashboard`, `unpaid`, `project`, `project-category`, `project-waiting`, `filed-today`, `txn`. Cycle 5 polls those keys every 15 seconds while `document.visibilityState` is `visible`, and pauses while it is hidden. The poll is not Supabase Realtime. Realtime is off on the local stack, and a poll reuses the RPCs already under the [$5](0034-cost-and-load-limits.md) cap.
4. While a change sheet, confirm sheet, or split screen is open for a row, or a finger is down on that row, a refetch does not change that row. On close, the owner's write wins. If it replaced a value the assistant had written, one plain toast says "השיוך שלך נשמר במקום הצעת העוזר". It replaces any toast already on screen. Lists take a refetched order only when nothing is touching the screen and scrolling has been still. Split uses the same hold. The cycle 5 poll uses this hold. It ships in cycle 2 with the first refetch.
5. The marker is the characters ` · בעוזר` appended to the row's existing muted hint. No icon, no chip, never ✦, never `SuggestTag`, and never on a הצעה line. On a review card the source hint is the line that gains it (`הוצאה · 22/09/2026 · בעוזר`). The hint is already part of the row's accessible name, so the marker is too. It shows on the Asia/Jerusalem day of the change, until the owner opens the detail or approves the row, whichever comes first. Opening the detail still shows it on that visit and clears it for the next fetch. Placement: a project transaction row (`חומרים · 22/09 · בעוזר`), the review-card source line, the detail line under the amount (`לפני מע״מ · … · בעוזר`), a שויכו היום row (`פרויקט · קטגוריה · בעוזר`), and a project category row (`22/09 · בעוזר`). The flag is `transactions.assistant_hint_until`, set by the MCP write to the end of that Jerusalem day, cleared by approve, skip, and `mark_assistant_seen`. Null means no marker. The app's own writes do not set it.
6. A bulk apply carries one `batch_id` and runs in one database transaction. While the app is in the foreground, one toast per batch says "N תנועות שויכו בעוזר". A newer batch replaces that toast. It does not queue. ביטול is on that toast only when `undo_batch` would still succeed. A single-row write shows no toast. שויכו היום offers one "ביטול כל השינויים" per batch, behind the list, on a `ConfirmSheet` with `destructive` (the danger-tint confirm). Screen readers get one `role="status"` for that batch, the toast, and not a second live region from the list.
7. שויכו היום keeps the count equal to the rows, and the copy stays true. This amends [0069](0069-back-and-one-tap-review.md) point 11 and the empty sentence in [0072](0072-design-review-rulings.md) point 11. The list is today's auto-assigned SUMIT rows that are not in an open review, plus rows whose latest assignment today was the assistant and that are not in an open review. A row in both sets is one row. An open suggestion is not on this list. When every row is the old set, the banner stays "N תנועות שויכו היום בלי להמתין בתור". When any row is an assistant filing, the banner is "N תנועות שויכו היום". The empty body is "כש־SUMIT משייך תנועה בלי תור, או כשהעוזר סוגר תנועה היום, היא תופיע כאן." Assistant rows use the marker from point 5.
8. Cycle 2 adds the Settings row under the SUMIT block, in its own section "עוזר", using the same list, sheet, and confirm sheet as SUMIT. Empty: title "עוזר", hint "לא מחובר", action "חיבור עוזר". The connect sheet shows the secret once and has "העתקה". Connected: "מחובר · שימוש אחרון …", or "מחובר · עדיין אין שימוש" when `last_used_at` is null. ניתוק is a destructive confirm sheet. Loading keeps the row busy and does not pretend to be connected. An error uses the SUMIT `FormError` under the row and leaves the last known state. With no company yet, the row is disabled and the hint says why. `last_used_at` is a column on the credential, set when a call is accepted.

`approve_review` names one in-app action. The RPC branch is אישור, moved into `public.approve_review_item` so the edge function does not copy `flow-screens.tsx`. The app's אישור calls that function with `p_remember: false`, which keeps [0069](0069-back-and-one-tap-review.md) point 3. The assistant calls it with `p_remember` default true, which is the change sheet's לזכור לספק הזה. A split still takes `approve_split_review`, which does not write a supplier rule, and the tool returns `remembered: false`. The assistant confirms with the owner before `finish_project`. The app does not ask again. The app shows nothing for a preview, a rate limit, or `batch_too_large`.

### Bulk preview

`bulk_assign` with no confirmation does not write. `dry_run: false` without a confirmation returns `validation`. The preview calls the real write functions inside one transaction, captures each row's `updated_at` from before the write, then rolls the transaction back. A refusal comes back as `refused` and no confirmation. A clean preview returns a server-signed confirmation: the SHA-256 of the canonical items, each `transaction_id` with that `updated_at`, and an expiry five minutes out. The signature is HMAC-SHA256 with `FLOW_MCP_KEK`. Apply sends the same items and that confirmation. The function checks the signature, the expiry, and the hashes, re-reads `updated_at`, and only then writes. A mismatch returns `conflict` and writes nothing. A preview counts as one write toward the rate limit. An apply counts as one write.

### SQL the cycles add

`private.mcp_credentials` and `private.mcp_idempotency` and `private.mcp_auth_failures` have row level security on and no policies. `authenticated` has no grant. Idempotency is not a public table. The write wrappers insert the idempotency row in the same transaction as the write. The same key and the same hash return the stored response. The same key and a different hash return `conflict`. A preview does not consume the key. A rollback leaves no row.

| Function | Security | Execute granted to | Revoked from |
| --- | --- | --- | --- |
| `public.create_mcp_token(text, text[])` | definer | `authenticated` | `public`, `anon` |
| `public.list_mcp_tokens()` | definer | `authenticated` | `public`, `anon` |
| `public.revoke_mcp_token(uuid)` | definer | `authenticated` | `public`, `anon` |
| `public.mark_assistant_seen(uuid)` | definer | `authenticated` | `public`, `anon` |
| `public.search_transactions(...)` | invoker | `authenticated` | `public`, `anon` |
| `public.create_project(text, bigint)` | definer | `authenticated` | `public`, `anon` |
| `public.rename_project(uuid, text)` | definer | `authenticated` | `public`, `anon` |
| `public.finish_project(uuid, boolean)` | definer | `authenticated` | `public`, `anon` |
| `public.reassign_transaction` with `p_suggestion boolean default false` | definer | `authenticated`, `service_role` | `public`, `anon` |
| `public.set_transaction_category` with `p_suggestion boolean default false` | definer | `authenticated`, `service_role` | `public`, `anon` |
| `public.save_split_returning(uuid, jsonb, boolean)` | definer | `authenticated`, `service_role` | `public`, `anon` |
| `public.approve_review_item(uuid, boolean)` | definer | `authenticated`, `service_role` | `public`, `anon` |
| `public.preview_batch(jsonb)` | definer | `authenticated` | `public`, `anon` |
| `public.apply_batch(jsonb, uuid)` | definer | `authenticated` | `public`, `anon` |
| `public.undo_batch(uuid)` | definer | `authenticated` | `public`, `anon` |

`rename_project` and `finish_project` lock the project row and write it in that same function. The client does not read the name and then call `upsert_project`. A trimmed name that another project in the company already has returns `conflict` and does not write. `create_project` uses the same check.

`save_split` keeps its void return for the app. It calls `save_split_returning` with `p_close_review` true and discards the uuid. When that path closes an `unallocated_shared` review, the undo row stores `prior_review_id`, and `undo_reassign` reopens that review. `reassign_undo` stays revoked from `authenticated`. The undo id is the function's return value, not a table read. MCP `split_expense` calls `save_split_returning` with `p_close_review` false.

`approve_review_item` holds the branch at `flow-screens.tsx` (split and not `unallocated_shared` calls `approve_split_review`, otherwise `resolve_review` with `p_action` `approved`). The app and the tool both call it. `undo` with `kind: "review"` calls `reopen_review` only when the row's status is `approved` or `skipped`. A `changed` row is `refused`.

`reassign_transaction` and `set_transaction_category` gain `p_suggestion boolean default false`. Omitted, the app's call is unchanged. `true` with an open review writes the project and category, leaves the review open, leaves `user_assigned` false, and sets `category_suggested` true. The edge tool passes `true` when an open review exists. It does not accept that flag from the model.

Single-row `undo_reassign` keeps today's behavior: it restores the snapshot and overwrites a later edit. `undo_batch` does not. If any row's `updated_at` moved after the batch, `undo_batch` returns `conflict` and changes nothing.

### Token hygiene

The secret is `flow_mcp_` plus 43 base64url characters (256 bits from a CSPRNG). At rest the credential stores HMAC-SHA256 of the secret with pepper `FLOW_MCP_KEK`, not the secret. Comparison is constant-time. The secret is shown once. `expires_at` defaults to 90 days. `last_used_at` is updated on an accepted call. The secret travels only in the `Authorization` header. Query strings and bodies are rejected. Logs redact `Authorization`, the secret, and the signed JWT.

### Rate limits

Counters move in one SQL update on the credential row, and a second update for the user across tokens. One token: 60 reads and 20 writes a minute. One user: 120 reads and 40 writes a minute. A failed check of a secret counts toward 10 failures per source address a minute, then HTTP 429. Unknown, revoked, expired, and bad secrets are HTTP 401. They are not tool results. Over the limit is HTTP 429 with `retry_after_seconds`. `validation`, `conflict`, `refused`, `forbidden`, and `batch_too_large` are tool results with MCP `isError` true. A 25-item apply, a 25-item undo, and a preview each count as one write.

### Prompt injection

`initialize` instructions say that field values are data, not instructions, and that write tools take ids returned by a read tool. Error text is a fixed string from the refusal list in [MCP tools](../mcp/TOOLS.md). It is never built from a description, a supplier, or a project name. An unknown database exception becomes `refused` with "The write was refused." A contract test fails if a tool name is outside the allowlist in that file. There is no outbound HTTP tool and no tool that returns a secret, a SUMIT key, or a raw row dump.

### Audit

`private.audit_row()` copies `flow.actor` into `audit_log.meta.channel` (`mcp` or `app`). The MCP wrappers also set `flow.token_id` and `flow.batch_id` for that transaction. The app never sets them, so its rows stay `channel` `app` with no token and no batch. `actor_id` remains `auth.uid()`.

### CI

The check job runs the function's Deno tests. The e2e job serves `flow-mcp` against local Supabase and calls each shipped tool with a local user. It uses the local JWT secret and a local pepper. It does not receive production secrets. The production deploy job, after the app deploy, deploys `flow-mcp` and sets the function secrets from the GitHub environment `production`: `FLOW_MCP_KEK`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`. Those three are not on pull-request jobs. The service-role key in that job is the credential lookup only.

### Cycles

Hours are implementation time for that cycle.

| Cycle | What ships | Hours |
| --- | --- | --- |
| 1a | Function skeleton, HMAC lookup, 60-second JWT, read scope, read tools on existing RPCs, rate-limit SQL, Deno tests, `tools/list` from those handlers | 6 |
| 1b | `search_transactions`, filed and all search, cross-company tests for the reads | 4 |
| 2 | Settings mint, list, and revoke; suggestion writes; atomic create, rename, and finish; idempotency; audit token id; focus refetch; hold; closed-item no-op; visit counter; write pgTAP | 16 |
| 3 | `approve_review_item` shared with אישור; skip; split returning and review reopen on undo; collapse; שויכו היום membership and copy | 8 |
| 4 | Signed bulk preview and apply, `batch_id`, `undo_batch`, the one toast, the confirm sheet | 9 |
| 5 | 15-second visible poll, the marker on the five surfaces | 6 |

OAuth 2.1, if a later client cannot hold the secret, is about 8 hours and is not one of these cycles.

### Noted, not in this revision

A newer MCP protocol revision, an `Origin` check, HTTP 405 on GET, and rejecting JSON-RPC batches can wait. `reassign_transaction` allows a finished project and `collapse_split` refuses one. The tools keep that difference and say so. The refusal strings that are not row text are listed in [MCP tools](../mcp/TOOLS.md). Passing a review id to a transaction tool is `validation`, with no lookup that guesses.

## Alternatives rejected

Storing the app's refresh token, or a second GoTrue refresh token, on the credential row. Rotation would log the app out or race, and Google sign-in does not mint a second session cleanly.

Calling the write RPCs with the service role. One missed filter crosses companies.

A bulk `dry_run: false` that writes without a signed preview. The preview has to be the real checks, rolled back, and the apply has to bind to that payload.

Copying the אישור branch into the edge function. It would drift from `flow-screens.tsx`.

Supabase Realtime for cycle 5. It is off locally, and the poll uses the queries the app already runs.

A second set of assignment tables. The app and the assistant would disagree, and undo would diverge.

Writing SUMIT. [0036](0036-sumit-read-only.md) stands. The connector does not expose the SUMIT writers or `delete_transaction`.

## Consequences

No application code, migration, or edge function ships with this record.

אישור keeps `p_remember: false` by passing it. The assistant's default is true. An MCP suggestion does not auto-approve and does not skip לאישור.

`finish_project` is status `finished`. There is no separate archive flag.

## Open questions

1. Which client connects first? The secret is the path in these cycles. OAuth waits unless that client cannot store it.
2. Should a tagging decision also remember the project on the supplier? Category remember already exists. Nothing writes `remembered_project_id`.
3. May the assistant create a category, or only assign what `list_categories` returns? This record does not create categories ([0008](0008-flat-categories-hide-or-merge.md)).
