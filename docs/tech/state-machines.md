# State machines

Every part of Flow that has a small set of states and rules for moving between them, where it lives, and how well the code says so. Decision [0266](../decisions/0266-explicit-state-machines.md) is the rule; this page is the map.

Read this before you change a flow: a save, a sheet, a sync, a status column. If the machine is **explicit**, change its table. If it is **implicit**, the states and moves below are what the code does today, recovered by reading it on 2026-11-10 (commit `4422924`); make it explicit in the PR that changes it, or keep to what is written here.

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
| `saveFlow` | `app/src/save-flow.ts` | `idle`, `saving`, `failed` | Setup steps 1, 3, 5 and 7 (`app/src/setup/steps.tsx`) |

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
| Change sheet | `ui/change-sheet.tsx` | View `summary`, `project`, `category`, `new`, derived from 12 state values, 13 refs and `?pick=` | `new` is not a history entry, so the browser's Back and the sheet's back land in different places ([FLOW-1167](../backlog/tasks/FLOW-1167.md)) |
| Sheet and its history entry | `ui/sheet.tsx`, `ui/back.tsx`, `ui/route-sheet.tsx` | closed, open, busy (close queued), deciding, closing; 8 refs, plus the history layer's unpushed, pushing, pushed, popped | A parent that ignores `onOpenChange(false)` leaves `closing` set, and later closes do nothing; a `onBeforeClose` that never settles blocks every close (FLOW-1167) |
| Toast | `ui/toast.tsx` | `off`, `measure`, `pad`, `fade`, `in`, `out`: one union set from six places, plus `hold {hover, focus, press}` | A mouse press released outside the toast leaves `press` set and the timer paused (FLOW-1167) |
| Setup wizard | `setup/model.ts`, `setup/storage.ts`, `setup/route.tsx`, `setup/steps.tsx` | Per step: done, skipped, neither or both, from stamps and server facts. Run: not started, started, resumed, skipped-all, finished. The step is the URL | A setting refused after the company was created loses the run's start; skip-all fails without a word; the step's skip and back stay live during a save ([FLOW-1161](../backlog/tasks/FLOW-1161.md)) |
| Disconnect with an undo window | `connection-undo.ts`, `use-connector-disconnect.ts` | absent, waiting, sending, gone; map membership and a nullable `sending` | A rejected `onSent` leaves the entry forever, so the slot reads as leaving (FLOW-1167) |
| New version reload | `sw-reload.ts` | current, behind, reload now or on the next move, reloaded; closure flags and two session keys | The loop guard drops a pending reload (FLOW-1167) |
| Push subscribe | `push.ts` (`SubscribeStep`) | permission, worker, controller, lookup, unsubscribe, subscribe, save, done; one variable in one function | The step reported with a timeout is not always the step reached (FLOW-1167) |
| Touch gestures | `ui/swipe-row.tsx`, `ui/card-swipe.tsx`, `ui/period-swipe.tsx`, `ui/edge-back.tsx`, `ui/code-field.tsx` | idle, tracking, axis locked, commit or settle; a `track` ref each | `PeriodSwipe` drops a second finger without settling (FLOW-1167) |
| List order hold | `list-hold.tsx` | held is the OR of `press`, `focus`, `sheet`, `scrolling` | A pointer that never reports up keeps `press` (FLOW-1167) |
| Online state | `connection.ts` | online, offline, offline and checking | A check started for one offline event can answer after a later one (FLOW-1167) |
| Screen read phase | `ui/screen-phase.ts`, `query-phase.ts` | `loading`, `error`, `empty`, `ready`, from an if-chain over the query's flags | `empty` comes only from a preview; each screen checks real emptiness itself |
| Skeleton timing | `ui/skeleton.tsx`, `ui/offline-wait.tsx` | nothing (under 300 ms), skeleton, fading, gone, or the offline line | None found |
| Company role | `use-is-viewer.tsx` | `loading`, `viewer`, `editor`, `owner`, `unknown`, from the query, a stored copy and the pinned context | Not signed in reads as `owner` |
| Write with retry and undo | `use-write.ts`, `project-forecast-writes.ts`, `forecast-skip.ts` | React Query's mutation states plus a retry toast, a snapshot and "undo asked before the write answered" flags | None found |
| Transaction stepping | `txn-step-nav.tsx`, `txn-list-more.ts` | Position from the route state plus `{more, extra, loading}` | A load in flight when the entry is replaced loses its result (FLOW-1167) |
| Attention rows | `ui/attention-cards.tsx`, `ui/fold.tsx` | shown, leaving (240 ms), hidden (4 s undo), restored | None found |
| Install prompt | `ui/install-prompt.ts` (`InstallMode`) | Derived on each call from the device and a saved browser event | A dismissed native prompt switches to manual steps without a word |
| Mercury connection view | `mercury-state.ts` | Per connection: `chosen` × `keyWorks` × `syncing` | `!chosen && syncing` and `!keyWorks && syncing` can be built; the server's `connected` is not read |

Status read from data, with no moves on the client (pure functions): a month `past`, `current`, `future` and the drawer's cell (`home-month.ts`); a charge `arrived`, `late`, `soon`, `later` (`recurring-charge.ts`); a loan `open`, `paid_off`, `closed` (`packages/shared/src/loan-split.ts`); a loan schedule's interest-only, level and balloon phases (`packages/shared/src/loan-schedule.ts`); a utility bill `refunded`, `seen`, `not_refunded`, `waiting` (`utility-refund-view.ts`).

### App: screens (`app/src/screens`)

| Machine | Where | States (how held) | Open gaps |
| --- | --- | --- | --- |
| Review's change sheet | `change-form.tsx` | open, resolved here, closed elsewhere, dropped, seeded by Jev, on hold; seven writes in one scope and about twelve refs | Picks queue with no pending guard, and each write reads its payload from a single-slot ref a later pick overwrites ([FLOW-1165](../backlog/tasks/FLOW-1165.md)) |
| Transaction page | `transaction-screen.tsx`, `transaction-approve.tsx`, `transaction-rule-offer.tsx` | Draft project and category, committed target, hold, review pending, rule offer, four sheets | Picks can overlap and share one undo slot; delete is not blocked by a write in flight (FLOW-1165) |
| Review queue card | `review-queue.tsx`, `review-swap.ts` | Card `still`, `out`, `in`; approving; skipped list; project picker | Skip is gated by the swap only, not by an approve in flight (FLOW-1165) |
| Line split editor | `line-split-editor.tsx`, `split-back.ts` | clean, dirty, invalid, warned, saving, refused, blocked | `saving` clears before the reads are refreshed and the page leaves, so a second write is not blocked; the retry toast runs a stale closure ([FLOW-1164](../backlog/tasks/FLOW-1164.md)) |
| Journal composer | `journal-composer-screen.tsx` | Start `jev`, `copy`, `free`; balanced or held; `saving`; `error` | The same early `saving` clear and stale retry (FLOW-1164) |
| Loan match on a line | `loan-match-row.tsx`, `loan-match.tsx`, `loan-match-api.tsx` | none, matched, matched and to review; sheet, draft, correcting, undo sent | Edit and the undo's rematch check no write in flight (FLOW-1164) |
| Loan page | `loan-detail-screen.tsx` and its sheets | One sheet of eight, four busy flags, a close guard | The close guard is one boolean, so overlapping saves release it early (FLOW-1164) |
| New loan sheet | `loans-host.tsx`, `loan-setup.tsx` | View `form`, `project`; draft in refs; posted | None found |
| Jev connector scope | `jev-connector-scope.ts` (`JevScopePhase`) | `off`, `pending`, `ready`, `miss`, with four module variables beside it | `off` with a bound scope can be built; after a miss a scope binds but the phase stays `miss` (FLOW-1164) |
| Jev settings card | `jev-settings.tsx` | `enabled` × mode `off`, `shadow`, `auto` × status `ready`, `error`, `loading` | `enabled` with mode `off` is storable and reads as off ([FLOW-1166](../backlog/tasks/FLOW-1166.md)) |
| Mercury connection page | `mercury-connection-screen.tsx`, `mercury-accounts-step.tsx` | A ladder over URL params, server fields and `replacing`: key form, list, reconnect, accounts, editing, connected | `replacing` is not reset when the slot changes |
| SUMIT connection page | `connection-pages.tsx`, `connections-status.ts` | `new`, `problem`, `connected`, `loading`, `error`, `viewer` | None found |
| AI assistant keys | `assistant-settings.tsx`, `assistant-setup.tsx` | Server `empty`, `connected`, `expired`; view `home`, `new`, `key`; minting, secret shown, first use | A failed revoke after a mint is silent (FLOW-1164) |
| Forecast moves | `forecast-screen.tsx`, `forecast-item-page.tsx` | Pending move: toast, fold timer, sent or cancelled | The toast shows before the write; a screen that unmounts first never sends it (FLOW-1164) |
| Recurring charge page | `recurring-charge-screen.tsx` and its sheets | Alert active or ignored, match unanswered, same or never, pace; local overrides | Local overrides are never cleared, and the writes have no guard (FLOW-1164) |
| Unpaid invoices | `unpaid-actions.ts` | open, marked, linked, match dismissed | No pending guards on mark, link and dismiss (FLOW-1164) |
| Notifications | `notifications-screen.tsx`, `review-push-prompt.tsx` | Device `subscribed`, `not-subscribed`, `no-worker`, `unsupported`, `ios-home-screen`; per-key save loop | None verified |

Patterns many screens share, each a candidate for one shared machine:

- **A sheet form with `busy` and `error`**, reset on open, close refused while busy (about 20 sheets: the loan sheets, the member report sheets, add entry, the category, company, project and team sheets). All guard in the handler. `saveFlow` fits them as it is.
- **A write whose result sits in a single-slot ref, and a toast whose ביטול sends the inverse** (`category-manage.ts`, `rename-company`, `team-sheets`, `loans-host`, `categories-screen` and others). The undo carries no pending guard.
- **An optimistic local set, a raw `await`, an undo toast** (`transfers-screen`, `recurring-changes-screen`, `project-utilities-screen`, `recurring-skip-month`). No guard against two in flight.
- **Save on close with one hold**: the first close warns, the second discards (`line-split-editor`, the investment and returns sheets, `change-form`, `transaction-screen`).

### Edge functions (`supabase/functions`)

| Machine | Where | States (how held) | Open gaps |
| --- | --- | --- | --- |
| Mercury connection sync | `mercury-sync/index.ts`, `_shared/cron_claim.ts` | not chosen, auth-stopped, held, quiet, claimed, due, running, mid-pagination; all read from the connection row's nullable fields | A page-capped run clears every pending line's missing-since clock; the commit is three steps, not one ([FLOW-1162](../backlog/tasks/FLOW-1162.md)) |
| Mercury fetch cursor | `_shared/connectors/mercury/client.ts` (`MercuryCursorPhase`) | idle (a timestamp) or resuming in `window`, `pending` or `treasury` (JSON) | A treasury resume whose account is gone restarts at the first account with the old page token; a loop cap never leaves (FLOW-1162) |
| Bank line and its recheck | `_shared/connectors/engine.ts`, `mercury-sync/stored.ts` | `pending`, `posted`, `void`, and "missing since" for a pending line the fetch no longer lists | A passing recheck error starts the missing clock without a 404 (FLOW-1162) |
| Refresh request queue | `mercury-sync/index.ts`, `sumit-sync/index.ts` | queued, claimed (also the end) | A skipped run uses up the request; the drain ignores `forced` ([FLOW-1163](../backlog/tasks/FLOW-1163.md)) |
| SUMIT sync | `sumit-sync/index.ts`, `_shared/sumit-policy.ts` | auth-stopped, held, quiet, busy, running | No resumable cursor: past 20 pages every run fails the same way (FLOW-1163) |
| Jev tagging job | `_shared/jev_tag.ts`, `jev_tag_rest.ts`, `jev_tag_plan.ts` | Connector disabled, `shadow`, `auto`; run gated, leased, listed, capped, tagging, finished; line untagged, tagged, prefilled, failed until retry | The rate gate is spent before the lease; a failure that will never pass retries daily and spends a call ([FLOW-1168](../backlog/tasks/FLOW-1168.md)) |
| `flow-mcp` request | `flow-mcp/handler.ts`, `preauth.ts`, `sign.ts` | Key active, expired, revoked, restorable; session current or stale; a fixed order of gates | A stale session stays stale until the client initialises again (by design) |
| `flow-mcp` `sync_bank` job | `flow-mcp/tools_sync.ts` | `proceed`, `replay`, running, finished ok or error, stale | A refused `finish` is not noticed; a page-capped pull is stored as a success (FLOW-1168) |
| Mercury connect | `mercury-connect/index.ts`, `_shared/connectors/mercury/scope.ts`, `legacy.ts` | Slot choice `replace`, `add`, `refused`; old-schema mode | The cursor is cleared before the new key is stored, so a failure between them stops the old connection (FLOW-1163) |
| Push send | `_shared/push_send.ts` | Evening marks after the send (at least once); new and weekly mark before it (at most once) | A failed new or weekly send is lost (FLOW-1168) |
| Invite email | `_shared/invite_email.ts` | lookup, claim (3 per invite), send | The claim is spent before the send (FLOW-1168) |
| Key envelope format | `_shared/envelope.ts`, `sumit-reseal/index.ts` | Format 1, 2 or 3, read from two columns | Format 2 rows are never upgraded |

The CD pipeline (`.github/workflows/ci.yml`, `scripts/cd-*.sh`), the deploy batching (`scripts/ci-deploy-plan.sh`) and the local gate (`scripts/local-ci*.sh`) are ordered phases with their own guards; no gap was found beyond the short window where four functions run old code on a new schema.

### Database (`supabase/migrations`)

| Machine | Columns | States | Where moves are checked | Open gaps |
| --- | --- | --- | --- | --- |
| Review item | `review_queue.status`, `reason`, `resolved_at` | `open`, `approved`, `skipped`, `changed`, and no row | `WHERE status = 'open'` in about twenty functions | Two open rows for one line can be stored; `skipped` has three meanings; `reason` is free text ([FLOW-1166](../backlog/tasks/FLOW-1166.md)) |
| Ledger line | `transactions.line_status`, `removed_at`, four provenance flags | `pending`, `posted`, `void`; live or removed | A `CASE` in `upsert_connector_lines` keeps `void` sticky | No `CHECK` ties `line_status` to `removed_at`, or the four flags to each other (FLOW-1166) |
| Loan | `loans.status`, `closed_on`, `refinanced_into_id` | `open`, `paid_off`, `closed`; refinanced; deleted and restored | `CHECK` open ⇔ no close date; a trigger on close | Any status may follow any other; a direct write can set a refinance link on an open loan or make a cycle (FLOW-1166) |
| Connector connection and queue | `connector_connections`, `connector_refresh_requests` | connected, syncing, backing off, accounts chosen; request open or claimed | The claim's `WHERE`; the cursor's compare-and-set | A claimed request is never closed; a passing failure after `auth` reads as connected again; claim and rejection are not per slot (FLOW-1163) |
| MCP write log and undo | `private.mcp_writes.undone_at`, `reviewed_at` | live, undone; for bookings also waiting, approved | Each undo checks the row still reads as written | The kinds and their undo rules live in one function patched by string replace |
| Jev job | `company_integrations`, `jev_usage`, `jev_line_failures`, `private.jev_run_lease`, `jev_prefills` | on or off by `enabled` × `mode`; lease free, held, expired; usage reserved or finished; prefill active or undone | The lease's `WHERE` | `enabled` and `mode` can disagree; a run that never finishes holds its reservation for the day (FLOW-1166) |
| Prepaid schedule | `prepaid_schedules.status`, `prepaid_rows.entry_id`, `companies.books_closed_through` | `active`, `completed`, `ended`; row planned or posted | `CHECK` on `ended`; `private.prepaid_lock` | The books-closed date is read by five functions only; an active row with an end date can be stored (FLOW-1166) |
| Team invite | `company_invites.status`, `expires_at`, `seen_at` | `pending`, `accepted`, `declined`, `cancelled`; expired is derived | `status <> 'pending'` in each function | An expired invite blocks a new one to the same address until it is cancelled (FLOW-1166) |
| Account | `accounts.archived_at` | active, archived (merged away is stored as archived) | `CHECK`, and an archive blocker | A merged account can be restored |
| App undo ticket | `reassign_undo.undone_at` | live, undone | `undone_at is null` | Undo does not check that the line still reads as written, so an out-of-order undo overwrites later edits (FLOW-1166) |
| Utility refund answer | `utility_refund_answers.state` | `matched`, `rejected`, `seen` over the read-time states | `CHECK`s and unique indexes | `keep_category` with a refile can be reached |
| MCP key | `private.mcp_credentials.revoked_at`, `expires_at` | active, expired, revoked (restorable for 10 minutes) | `WHERE` clauses and a lock | None found |
| Transfer match | `transfer_matches.same` | no row, true, false | Unique indexes and the pair rules | None found |
| Project | `projects.status`, `finished_on` | `active`, `finished` | None | `finished_on` is not tied to `status`; a finished project still takes filings (FLOW-1166) |

Plain labels that never change after the row is written are not machines and are not listed: `vat_status`, `txn_direction`, `txn_source`, `pnl_role`, `category_kind`, `split_method`, `loan_kind`, and the like.

## Keeping this page true

- A PR that adds a machine, or changes a machine's states or moves, updates its row here.
- A PR that moves an implicit machine onto `defineMachine` moves its row to "Explicit machines" and closes the gaps the table makes impossible.
- A gap you fix leaves the row; a gap you find joins it, with a task.
