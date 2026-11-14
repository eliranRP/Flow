# State machines

Every part of Flow that has a small set of states and rules for moving between them, where it lives, and how well the code says so. Decision [0266](../decisions/0266-explicit-state-machines.md) is the rule; this page is the map.

Read this before you change a flow: a save, a sheet, a sync, a status column. If the machine is **explicit**, change its table. If it is **implicit**, the states and moves below are what the code does today, recovered by reading it on 2026-11-10 (commit `4422924`), with the gaps closed in #1125 taken out; make it explicit in the PR that changes it, or keep to what is written here.

## How to write one

A machine is one table: each state, the events it accepts, and where each leads. `defineMachine` (`packages/shared/src/machine.ts`) builds it; the app, the edge functions and `flow-mcp` can all import it.

```ts
export const saveFlow = defineMachine({
  name: "saveFlow",
  initial: "idle",
  states: {
    idle: { start: "saving" },
    saving: { done: "idle", fail: "failed", stop: "idle" },
    failed: { start: "saving", clear: "idle" },
  },
});
```

- **An event a state does not list changes nothing.** `saving` has no `start`, so a second tap cannot start a second save. A guard is a missing row, not an `if` in each handler.
- **In a component**, `useMachine(machine)` (`app/src/use-machine.ts`) gives `{ state, send }`. `send(event)` answers `true` only when the machine moved or was allowed to, read from the machine's own state and not the drawn one, so `if (!flow.send("start")) return;` is safe against two taps in one tick.
- **Every machine has a test** that asserts `machineProblems(machine)` is empty: every state is reached, and every state that is not `final` has a way out. A state added without a way in or out fails there.
- **Data stays beside the machine.** The machine holds which state it is in; what the state carries (the failed outcome, the draft) stays in its own variable.
- **In SQL**, the table is a `CHECK` that ties the columns of a state together, and a `WHERE status = …` in the one function that makes each move. The machines below say which have that and which do not.

`machineEdges(machine)` lists a table's moves as data, for a test, a doc or an agent.

## Explicit machines

| Machine | Where | States | Used by |
| --- | --- | --- | --- |
| `saveFlow` | `app/src/save-flow.ts` | `idle`, `saving`, `failed` | Setup steps 1, 3, 5 and 7 (`app/src/setup/steps.tsx`); the journal composer and the line split editor (`saving` lasts until the page has left); the review card's picked project (`review-queue.tsx`) |
| `disconnectFlow` | `app/src/connection-undo.ts` | `waiting`, `sending`, `gone` | A disconnect's undo window: `send` puts it on the wire; ביטול, another company, a dropped role or a newer wait end it unsent |
| `mercuryFetchPhases` | `supabase/functions/_shared/connectors/mercury/machines.ts` | `window`, `pending`, `treasury`, `done` | Which lists a Mercury fetch runs, and which run after a resume (`mercuryPhasesFrom`) |
| `refreshRequest` | `supabase/functions/_shared/refresh_queue.ts`; in SQL, `20261109222332_refresh_request_lifecycle.sql` | `queued`, `claimed`, `finished` | A connector refresh request: `claim`; then `requeue` (the run threw, or another run held the connection), `finish` (it synced, or skipped for a reason a retry cannot change) or `lapse` (its run died; the next claim deletes it). `settle_connector_refresh` makes the moves |
| `mercuryRepeatedPage` | the same file; the count is `settings.repeated_page_runs` (`mercury/sync_settings.ts`) | `clear`, `once`, `twice`, `stopped` | Runs in a row that failed on a repeated page token. At `stopped` the cron and an unforced run skip the connection; the owner's own refresh still runs it, and a success or a reconnect clears it |
| `mercuryCommit` | the same file | `lines`, `labels`, `stamp`, `done` | The order mercury-sync writes a plan in; a partial fetch skips `stamp`. Three steps, not one transaction |

These already keep one union and one place that moves it, without `defineMachine`. They are fine as they are; move one onto the helper when you next change it.

| Machine | Where | States |
| --- | --- | --- |
| Pull to refresh | `app/src/ui/pull-refresh.tsx` (`PullPhase`) | `idle`, `pulling`, `refreshing`, `returning`, `closing` |
| Sign-in status | `app/src/auth.tsx` (`AuthStatus`) | `loading`, `anon`, `authed`, `unconfigured` |
| Report address | `app/src/reports.ts` (`ReportState`) | Parsed from the URL: kind, period, as-of date, scope |
| Visit meter | `app/src/visit-meter.ts` | open, handled, left (pure reducers) |
| Weekly summary card | `app/src/screens/weekly-summary-card.tsx` | `shown`, `leaving`, `gone` |
| Loan split editor mode | `app/src/screens/loan-split-editor.tsx` (`Mode`) | `schedule`, `exact` |
| Invitation | `app/src/screens/invites-screen.tsx` (`InviteState`) | `open`, `joined`, `declined` (local; expired is derived) |
| MCP bank-sync job | `private.mcp_sync_jobs.state` | `running`, `done`, `failed`; one `CHECK` ties state, finish time, result and error |
| Utility refund actions | `app/src/screens/utility-refunds-actions.ts` | visible, folding, hidden; one `answer()` carries six actions |

## Implicit machines

Held in booleans, refs, nullable timestamps or scattered `WHERE` clauses. "Open gaps" are states the code can reach or store that mean nothing, or moves nothing blocks; each was read in the code, not run, so check it still happens before you fix it. The task that owns it is named.

### App: shared parts (`app/src`, `app/src/ui`)

| Machine | Where | States (how held) | Open gaps |
| --- | --- | --- | --- |
| Change sheet | `ui/change-sheet.tsx` | View `summary`, `project`, `category`, `new`, derived from 12 state values, 14 refs and `?pick=`; `new` has its own browser entry (`newEntry`) | None open: the browser's Back and the sheet's back both leave `new` for the picker. Still not a table |
| Sheet and its history entry | `ui/sheet.tsx`, `ui/back.tsx`, `ui/route-sheet.tsx` | closed, open, busy (close queued), deciding, closing; 8 refs, plus the history layer's unpushed, pushing, pushed, popped | A parent that ignores `onOpenChange(false)` (returns nothing, passes no `busy`) leaves `closing` set, and later closes do nothing. No caller does today; a refused close returns `false` |
| Toast | `ui/toast.tsx` | `off`, `measure`, `pad`, `fade`, `in`, `out`: one union set from six places, plus `hold {hover, focus, press}` | None open; the phases are still set from six places (FLOW-1167) |
| Setup wizard | `setup/model.ts`, `setup/storage.ts`, `setup/route.tsx`, `setup/steps.tsx` | Per step: done, skipped, neither or both, from stamps and server facts. Run: not started, started, resumed, skipped-all, finished. The step is the URL | The run and step states are not a table yet ([FLOW-1161](../backlog/tasks/FLOW-1161.md)) |
| New version reload | `sw-reload.ts` | current, behind, reload now or on the next move, reloaded; closure flags and two session keys | None open |
| Push subscribe | `push.ts` (`SubscribeStep`) | permission, worker, controller, lookup, unsubscribe, subscribe, save, done; one variable in one function | The step reported with a timeout is not always the step reached (FLOW-1167) |
| Touch gestures | `ui/swipe-row.tsx`, `ui/card-swipe.tsx`, `ui/period-swipe.tsx`, `ui/edge-back.tsx`, `ui/code-field.tsx` | idle, tracking, axis locked, commit or settle; a `track` ref each | None open |
| List order hold | `list-hold.tsx` | held is the OR of `press`, `focus`, `sheet`, `scrolling` | None open |
| Online state | `connection.ts` | online, offline, offline and checking | None open |
| Screen read phase | `ui/screen-phase.ts`, `query-phase.ts` | `loading`, `error`, `empty`, `ready`, from an if-chain over the query's flags | `empty` comes only from a preview; each screen checks real emptiness itself |
| Skeleton timing | `ui/skeleton.tsx`, `ui/offline-wait.tsx` | nothing (under 300 ms), skeleton, fading, gone, or the offline line | None found |
| Company role | `use-is-viewer.tsx` | `loading`, `viewer`, `editor`, `owner`, `unknown`, from the query, a stored copy and the pinned context | Not signed in reads as `owner` |
| Write with retry and undo | `use-write.ts`, `project-forecast-writes.ts`, `forecast-skip.ts` | React Query's mutation states plus a retry toast, a snapshot and "undo asked before the write answered" flags | None found |
| Transaction stepping | `txn-step-nav.tsx`, `txn-list-more.ts` | Position from the route state plus `{more, extra, loading}` | None open |
| Attention rows | `ui/attention-cards.tsx`, `ui/fold.tsx` | shown, leaving (240 ms), hidden (4 s undo), restored | None found |
| Install prompt | `ui/install-prompt.ts` (`InstallMode`) | Derived on each call from the device and a saved browser event | A dismissed native prompt switches to manual steps without a word |
| Mercury connection view | `mercury-state.ts` | Per connection: `chosen` × `keyWorks` × `syncing` | `!chosen && syncing` and `!keyWorks && syncing` can be built; the server's `connected` is not read. A connection whose last sync ended on the page cap shows a warning on its row and page (`mercuryProblem`); the Settings › חיבורים row still reads connected |

Status read from data, with no moves on the client (pure functions): a month `past`, `current`, `future` and the drawer's cell (`home-month.ts`); a charge `arrived`, `late`, `soon`, `later` (`recurring-charge.ts`); a loan `open`, `paid_off`, `closed` (`packages/shared/src/loan-split.ts`); a loan schedule's interest-only, level and balloon phases (`packages/shared/src/loan-schedule.ts`); a utility bill `refunded`, `seen`, `not_refunded`, `waiting` (`utility-refund-view.ts`).

### App: screens (`app/src/screens`)

| Machine | Where | States (how held) | Open gaps |
| --- | --- | --- | --- |
| Review's change sheet | `change-form.tsx` | open, resolved here, closed elsewhere, dropped, seeded by Jev, on hold; seven writes in one scope and about twelve refs | None open: each pick and its ביטול carry their own values and undo id ([FLOW-1165](../backlog/tasks/FLOW-1165.md)) |
| Transaction page | `transaction-screen.tsx`, `transaction-approve.tsx`, `transaction-rule-offer.tsx` | Draft project and category, committed target, hold, review pending, rule offer, four sheets | None open: the picks run in one scope with their own undo id, and delete waits for a write |
| Review queue card | `review-queue.tsx`, `review-swap.ts`, `review-held.tsx` | Card `still`, `out`, `in`; approving; skipped list; project picker (its save is `saveFlow`). A `closed_month_change` card has one move: אישור runs the same approving write with `leave_held_change` (open → left; a failure puts the card back); no picker, שינוי or דלג | While a picked project saves, the picker and אישור do nothing, with no busy cue on the card. Approving is still a ref keyed by the card, not a table |
| Line split editor | `line-split-editor.tsx`, `split-back.ts` | clean, dirty, invalid, warned, refused, blocked; the save itself is `saveFlow` | None open ([FLOW-1164](../backlog/tasks/FLOW-1164.md)) |
| Journal composer | `journal-composer-screen.tsx` | Start `jev`, `copy`, `free`; balanced or held; `error`; the save itself is `saveFlow` | Editing legs keeps start `jev`, so the "Jev's suggestion" note stays on edited legs |
| Loan match on a line | `loan-match-row.tsx`, `loan-match.tsx`, `loan-match-api.tsx` | none, matched, matched and to review; sheet, draft, correcting, undo sent | The rematch is not checked by `canSave`; no reachable case was found (FLOW-1164) |
| Loan page | `loan-detail-screen.tsx` and its sheets | One sheet of eight, four busy flags, a close guard | None open: the close guard counts the saves in flight |
| New loan sheet | `loans-host.tsx`, `loan-setup.tsx` | View `form`, `project`; draft in refs; posted | None found |
| Jev connector scope | `jev-connector-scope.ts` (`JevScopePhase`) | `off`, `pending`, `ready`, `miss`, with four module variables beside it | `off` with a bound scope can be built; after a miss a scope binds but the phase stays `miss` (FLOW-1164) |
| Jev settings card | `jev-settings.tsx` | `enabled` × mode `off`, `shadow`, `auto` × status `ready`, `error`, `loading` | None open: `enabled` with mode `off` is no longer stored (`company_integrations_on_chk`); the setter stores it off ([FLOW-1166](../backlog/tasks/FLOW-1166.md)) |
| Mercury connection page | `mercury-connection-screen.tsx`, `mercury-accounts-step.tsx` | A ladder over URL params, server fields and `replacing`: key form, list, reconnect, accounts, editing, connected | `replacing` is not reset when the slot changes |
| SUMIT connection page | `connection-pages.tsx`, `connections-status.ts` | `new`, `problem`, `connected`, `loading`, `error`, `viewer` | None found |
| AI assistant keys | `assistant-settings.tsx`, `assistant-setup.tsx` | Server `empty`, `connected`, `expired`; view `home`, `new`, `key`; minting, secret shown, first use | None open |
| Forecast moves | `forecast-screen.tsx`, `forecast-item-page.tsx` | Pending move: toast, fold timer, sent or cancelled | The fold timer is not cleared on unmount (it still sends the write) (FLOW-1164) |
| Recurring charge page | `recurring-charge-screen.tsx` and its sheets | Alert active or ignored, match unanswered, same or never, pace; local overrides | Local overrides are never cleared, so they carry over to a new alert (FLOW-1164) |
| Unpaid invoices | `unpaid-actions.ts` | open, marked, linked, match dismissed | None open: one write per action at a time |
| Notifications | `notifications-screen.tsx`, `review-push-prompt.tsx` | Device `subscribed`, `not-subscribed`, `no-worker`, `unsupported`, `ios-home-screen`; per-key save loop | None verified |

Patterns many screens share, each a candidate for one shared machine:

- **A sheet form with `busy` and `error`**, reset on open, close refused while busy (about 20 sheets: the loan sheets, the member report sheets, add entry, the category, company, project and team sheets). All guard in the handler. `saveFlow` fits them as it is.
- **A write whose result sits in a single-slot ref, and a toast whose ביטול sends the inverse** (`category-manage.ts`, `rename-company`, `team-sheets`, `loans-host`, `categories-screen` and others). The undo carries no pending guard.
- **An optimistic local set, a raw `await`, an undo toast** (`transfers-screen`, `recurring-changes-screen`, `project-utilities-screen`, `recurring-skip-month`). No guard against two in flight.
- **Save on close with one hold**: the first close warns, the second discards (`line-split-editor`, the investment and returns sheets, `change-form`, `transaction-screen`).

### Edge functions (`supabase/functions`)

| Machine | Where | States (how held) | Open gaps |
| --- | --- | --- | --- |
| Mercury connection sync | `mercury-sync/index.ts`, `_shared/cron_claim.ts` | not chosen, auth-stopped, held, quiet, claimed, due, running, mid-pagination, and stopped on a repeated page token (`mercuryRepeatedPage`); the rest read from the connection row's nullable fields | `upsert_connector_lines` replays held changes before the fetched lines and returns `held`. The commit is three named steps (`mercuryCommit`), not one transaction; ([FLOW-1162](../backlog/tasks/FLOW-1162.md)) |
| Mercury fetch cursor | `_shared/connectors/mercury/client.ts` (`MercuryCursorPhase`), `mercuryFetchPhases` | idle (a timestamp) or resuming in `window`, `pending` or `treasury` (JSON) | None open |
| Bank line and its recheck | `_shared/connectors/engine.ts`, `mercury-sync/stored.ts`, `mercury/sync_settings.ts` | `pending`, `posted`, `void`, and "missing since" for a pending line the fetch no longer lists; a resumed window keeps the ids its partial runs listed in `settings.resume_listed` | None open |
| Refresh request queue | `mercury-sync/index.ts`, `sumit-sync/index.ts`, `_shared/refresh_queue.ts` | `refreshRequest` (see Explicit machines) | The queue is per company and provider, so one claim covers every Mercury connection of a company (by design) |
| SUMIT sync | `sumit-sync/index.ts`, `_shared/sumit-policy.ts` | auth-stopped, held, quiet, busy, running | No resumable cursor: past 20 pages every run fails the same way (FLOW-1163) |
| Jev tagging job | `_shared/jev_tag.ts`, `jev_tag_rest.ts`, `jev_tag_plan.ts` | Connector disabled, `shadow`, `auto`; run leased, gated, listed, capped, tagging, finished; line untagged, tagged, prefilled, failed until retry | A failure that will never pass retries daily and spends a call; the lease is not renewed (both need SQL, [FLOW-1168](../backlog/tasks/FLOW-1168.md)) |
| `flow-mcp` request | `flow-mcp/handler.ts`, `preauth.ts`, `sign.ts` | Key active, expired, revoked, restorable; session current or stale; a fixed order of gates | A stale session stays stale until the client initialises again (by design) |
| `flow-mcp` `sync_bank` job | `flow-mcp/tools_sync.ts` | `proceed`, `replay`, running, finished ok or error, stale | A refused `finish` is logged but the job still reads as running until stale; a page-capped pull is stored as a success (FLOW-1168) |
| Mercury connect | `mercury-connect/index.ts`, `_shared/connectors/mercury/scope.ts`, `legacy.ts` | Slot choice `replace`, `add`, `refused`; old-schema mode | The cursor is cleared before the new key is stored, so a failure between them stops the old connection ([FLOW-1163](../backlog/tasks/FLOW-1163.md): one transaction for the key and the clear is the fix) |
| Push send | `_shared/push_send.ts` | Evening marks after the send (at least once); new and weekly mark before it (at most once) | A failed new or weekly send is lost (FLOW-1168) |
| Invite email | `_shared/invite_email.ts` | lookup, claim (3 per invite), send | The claim is spent before the send (FLOW-1168) |
| Key envelope format | `_shared/envelope.ts`, `sumit-reseal/index.ts` | Format 1, 2 or 3, read from two columns | Format 2 rows are never upgraded |

The CD pipeline (`.github/workflows/ci.yml`, `scripts/cd-*.sh`), the deploy batching (`scripts/ci-deploy-plan.sh`) and the local gate (`scripts/local-ci*.sh`) are ordered phases with their own guards; no gap was found beyond the short window where four functions run old code on a new schema.

### Database (`supabase/migrations`)

| Machine | Columns | States | Where moves are checked | Open gaps |
| --- | --- | --- | --- | --- |
| Review item | `review_queue.status`, `reason`, `resolved_at`, `skipped_by` | `open`, `approved`, `skipped`, `changed`, and no row. At most one open row per line. `skipped_by` says what closed a skipped row: `person` (`resolve_review`'s skip: the queue's דלג or the assistant), `transfer` (a confirmed transfer match, `transfer_mark_line`) or `sumit_switch` (`replace_sumit_connection`); null when the row is not skipped and for skips before 2026-11-13 (unknown). The reason `closed_month_change` marks a held sync change: one open row per hold, closed only by `leave_held_change` (the owner or an editor, from the card's אישור) / `mcp_leave_held_change` (the assistant; its undo `held_change_left` puts the hold back to `held` and reopens the row) (approved, hold `left`) or by the replay (deleted) after the owner moves the closed date back through the assistant; `review_queue_held_change` refuses any other close | `WHERE status = 'open'` in about twenty functions; `review_queue_resolved_chk` (open ⇔ no resolution time); `review_queue_reason_chk` (the reasons the code writes, or none: `missing_category`, `missing_project`, `suggested`, `unallocated_shared`, `split_mismatch`, `closed_month_change`; the one list, a new reason joins it in its migration); `review_queue_open_line_key` (unique line among open rows): every guarded insert of an open row is `ON CONFLICT DO NOTHING`, so a sync never fails on it, and a reopen (`reopen_review`, `undo_reassign`, the transfer match's undo, `held_change_left`'s undo) happens only when no other row of the line is open, else the undo still succeeds and the newer row stays the card (the owner's decision, 2026-11-13), and an approved or changed row whose filing came back is deleted, after an invoice's paired receipts go back (else the sync would read it as settled); an open `split_mismatch` row gives way to a row that comes back; `review_queue_skipped_by_chk` (a kind only on a skipped row); the transfer match's undo reopens only a transfer's skip or an unknown one | A reopen that races a sync's insert for the same line can fail with a unique violation (the person's undo, not the sync; a retry succeeds) ([FLOW-1166](../backlog/tasks/FLOW-1166.md)) |
| Ledger line | `transactions.line_status`, `removed_at`, four provenance flags | `pending`, `posted`, `void`; live or removed; closed when it is posted, not removed, and its `doc_date` or `cash_date` is on or before `companies.books_closed_through` | A `CASE` in `upsert_connector_lines` keeps `void` sticky; `transactions_void_removed_chk` (a void line is removed; a removed line need not be void: the SUMIT sweep and `replace_sumit_connection` remove without void); `transactions_suggested_chk` (a suggested category is never the owner's: not with `user_assigned` or `category_assigned`, which the trigger `fill_suggested_category` already enforced on every write). A closed line takes no report-column change, insert or delete from a person: the triggers `transactions_lock_closed_month[_update]`, `allocations_lock_closed_month`, `overhead_lock_closed_month`, on the one predicate `private.books_closed_hit`; a pending line is free until it posts. A sync's change to a provider fact of a closed line is held in `private.closed_line_holds` (`held`, `left`) and replayed by the next sync once the line is no longer closed; filing the sync re-derives is kept; a new line dated closed enters | `user_assigned`, `project_assigned` and `category_assigned` are set independently by their writers, so no rule ties them. The closed-month triggers refuse a person only: a service-role writer other than the sync (the Jev job, the edge-called setters, the prepaid cron) is not refused, though the ones known to reach a closed line skip it ([FLOW-1166](../backlog/tasks/FLOW-1166.md)) |
| Loan | `loans.status`, `closed_on`, `refinanced_into_id` | `open`, `paid_off`, `closed` (the last two behave the same, decided 2026-11-10); refinanced; deleted and restored | `loans_closed_chk` (open ⇔ no close date); `loans_refinance_chk` (a refinance link only on a loan that is not open; validated); the trigger `loans_refinance_pair` (two loans never name each other); `loans_close_check` on a close and on an insert | Any status may follow any other (as decided). The app writes it only through `create_loan` and `update_loan` (FLOW-854), so each write still runs the table's checks and triggers |
| Connector connection and queue | `connector_connections`, `connector_refresh_requests` | connected, syncing, backing off, accounts chosen; the request is `refreshRequest` | The claim's `WHERE`; the cursor's compare-and-set; `settle_connector_refresh` | `stamp_connector_sync` still clears an `auth` stop (only in a race), and SUMIT's `note_sync_failure` still overwrites one; the claim window is still a literal in three read functions (FLOW-1163) |
| MCP write log and undo | `private.mcp_writes.undone_at`, `reviewed_at` | live, undone; for bookings also waiting, approved | Each undo checks the row still reads as written | The kinds and their undo rules live in one function patched by string replace |
| Jev job | `company_integrations`, `jev_usage`, `jev_line_failures`, `private.jev_run_lease`, `jev_prefills` | on when `enabled` and `mode` is `shadow` or `auto`; lease free, held, expired; usage reserved, finished, or stale (unfinished 15 minutes after it was reserved); prefill active or undone; line failure until a later success | The lease's `WHERE`; `company_integrations_on_chk` (`enabled` only with a mode that is on; `enabled` false may keep a remembered mode); `private.jev_calls_today` counts an unfinished reservation for 15 minutes only; `jev_finish_usage` clears the failure rows of lines that now have a suggestion | None open from FLOW-1166. A late finish of a stale run still records its calls; the calls a killed run made are not known and stop counting with its reservation |
| Prepaid schedule | `prepaid_schedules.status`, `ended_by`, `prepaid_rows.entry_id`, `companies.books_closed_through` | `active`, `completed`, `ended` (by `person` or `payment_removed`); row planned or posted | `prepaid_schedules_ended_chk` (ended ⇔ an end month and an end mode; validated); `prepaid_schedules_ended_by_chk` (a reason only on an ended schedule); `private.prepaid_lock`; the trigger `transactions_prepaid_removed` ends a schedule when its payment line is removed, an active one or an ended one that still has planned rows (planned rows dropped, posted kept, `keep`, `payment_removed`), with SKIP LOCKED, the daily job ending any it skipped | The books-closed date locks a person's edits to closed lines (see Ledger line); settings that move a closed month's figures without touching a line are not locked ([FLOW-1170](../backlog/tasks/FLOW-1170.md)). A payment line that comes back leaves its schedule ended (decided 2026-11-13); a void held in a closed month ends it only once applied |
| Team invite | `company_invites.status`, `expires_at`, `seen_at` | `pending`, `accepted`, `declined`, `cancelled`; expired is derived | `status <> 'pending'` in each function; `company_invites_decided_chk` (pending ⇔ no decision time; validated); `reopen_invite` refuses an invite past its expiry | None open: an expired invite no longer blocks a new one (`invite_member` cancels it and makes the new one), and the invitee's undo of a decline does not bring back an expired invite (FLOW-1166) |
| Account | `accounts.archived_at` | active, archived (merged away is stored as archived) | `CHECK`, and an archive blocker | A merged account can be restored |
| App undo ticket | `reassign_undo.undone_at`, `written_line` | live, undone | `undone_at is null`; `undo_reassign` compares the line, under its lock, with `written_line` (the filing's after-state in the columns the undo restores: project, category, role, the three provenance flags it restores, the allocations, the overhead row, and the parts it would leave: the split by category and a loan payment's parts) and refuses with `line changed since` when they differ, restoring nothing (the owner's decision, 2026-11-13). A sync's update of other columns does not block it | Tickets written before 2026-11-13 have no `written_line` and still restore without the check (FLOW-1166) |
| Utility refund answer | `utility_refund_answers.state` | `matched`, `rejected`, `seen` over the read-time states | `CHECK`s and unique indexes | `keep_category` with a refile can be reached |
| MCP key | `private.mcp_credentials.revoked_at`, `expires_at` | active, expired, revoked (restorable for 10 minutes) | `WHERE` clauses and a lock | None found |
| Transfer match | `transfer_matches.same` | no row, true, false | Unique indexes and the pair rules | None found |
| Project | `projects.status`, `finished_on` | `active`, `finished` | `projects_finished_chk` (an active project has no finish date; validated) | A finished project still takes filings (FLOW-1166) |

Plain labels that never change after the row is written are not machines and are not listed: `vat_status`, `txn_direction`, `txn_source`, `pnl_role`, `category_kind`, `split_method`, `loan_kind`, and the like.

## Keeping this page true

- A PR that adds a machine, or changes a machine's states or moves, updates its row here.
- A PR that moves an implicit machine onto `defineMachine` moves its row to "Explicit machines" and closes the gaps the table makes impossible.
- A gap you fix leaves the row; a gap you find joins it, with a task.
