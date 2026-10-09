# Flow backlog

Open tasks only. How to claim and finish a task is in the [backlog guide](README.md). Keep each task's status line current; a claim lives in an open draft PR titled `FLOW-<id>: <title>` with a `Claim` block in its body ([how](README.md#tracking-progress-so-lanes-dont-collide)). Before you start, read the open PRs and the table below.

Types: `SMALL CYCLE` (one PR, no new screen), `SMALL UI` (one PR with a UI change, design review), `PLAN FIRST` (plan and mockup, owner approval before any build), `BUG`, `MCP` (flow-mcp work), `BACKLOG NIT` (reviewer follow-ups, batch several per PR).

Statuses: `ready`, `claimed`, `in-progress`, `plan-first`, `on-hold` (owner's go needed), `blocked`, `done`.

Last full sync: 2026-10-07.

## Lanes now

Which lanes run and what each one is on ([lanes](README.md#lanes-and-how-many-run-at-once)). At most 2 dev task lanes at once. The open PRs and their `Claim` blocks say exactly which files are taken; this table says who owns what. Update it in the next PR that touches TASKS.md when a lane starts, stops, or changes what it owns.

| Lane | Owns now | Next |
| --- | --- | --- |
| Dev lane 1 | Free: FLOW-802 reverted (owner: not now); FLOW-401 server merged in #233, category rename in #228 | The next non-UI item |
| Dev lane 2 | FLOW-811: CI and deploy follow-ups (row-hash baseline script, composite foreign key indexes) | FLOW-812 faster CI (claim looks stale), more Flow MCP agent requests |
| UI lane 1 | Free: FLOW-335 + FLOW-336 + FLOW-337: period bar contrast and polish, the band-figure swipe (decision 0150), "לפי חודש" for the whole project, Unpaid polish, done in #239 | Jev bills and forecast (layout card with the owner), navigation (331, 334, rest of 322), loans page, company "לפי חודש" |
| UI lane 2 | FLOW-114 loan match on the transaction card, PR #252 (owner picked B, one row; FLOW-404 card merged #223) | The transaction detail hint of 322, review card fit at 375x667 |
| UI lane 3 | FLOW-334 H1 (sticky compact bar) + H2 (labelled Back) in ScreenHeader, and FLOW-322 except the transaction detail hint and Home, PR #259 (FLOW-124/125 merged #253) | Settings, project screens, and other areas outside the review and transaction screens |
| UI lane 4 | FLOW-706: undo a Jev fill from the review card while Jev is off (app only; FLOW-331 merged #245) | Next unclaimed UI task |
| UI/UX review cycle | Design lead; runs after each deploy batch (cycle 5 reviewed 89b9dc5) | Next deploy batch |
| Production QA | Deploy and prod check after each deploy, sandbox QA company only | Next deploy batch |
| Backlog bug fixes | FLOW-333 split editor C1, C3a, C3b, C3c, C4, C5, C7, C9 (#261) | toast e2e settle-wait flake (lane manager), then next small ready bug |
| File split | FLOW-807 follow-up, test files over the 1,200-line test limit (owner card, recommended option taken overnight): `flow-mcp/tools_test.ts` split by area (#251) into `tools_{reads,writes,setup,loans,loan_attach}_test.ts` with fixtures in `tools_test_support.ts`, then `_shared/jev_tag_test.ts` into `jev_tag_{plan,run,job,lines}_test.ts` with `jev_tag_test_support.ts` (#256), then `flow-mcp/handler_test.ts` into `handler_{auth,isolation,tools}_test.ts` with `handler_test_support.ts` (#257), then `screens/review-all.test.tsx` into `review-all`, `review-all-bar` and `review-all-skipped` (#263), then `screens/books-states.test.tsx` into `books-states`, `books-states-split` and `books-states-card` (#268), then `screens/round5-ui.test.tsx` into `round5-ui`, `round5-ui-settings` and `round5-ui-category` (#276), then `screens/sumit-row.test.tsx` into `sumit-row` and `sumit-row-nav` (FLOW-807 itself done: #219, #225, #227, #229, #232, #235, #249) | none for TypeScript: no test file is over 1,200 lines and no source file over 800. Left: `supabase/tests/database/mcp_cycle3a.test.sql` (1,652 lines), a pgTAP file, if the team wants SQL tests under the same limit |
| MCP/data agent | Real data through the MCP tools; never changes the repo | Requests go to the top of the queue |

## Priority queue

Take tasks in this order. On-hold and plan-first items are listed so nobody starts them by mistake.

| # | Id | Title | Type | Status |
| --- | --- | --- | --- | --- |
| 1 | [FLOW-102](#flow-102) | Unassigned bucket, overhead project, unpaid row on the invoiced basis | SMALL CYCLE | done (#71) |
| 2 | [FLOW-109](#flow-109) | Income assigned to a project: confirm it counts in that project | BUG | done (#74) |
| 3 | [FLOW-111](#flow-111) | update_loan can store a payment below the interest | BUG | done (#72) |
| 4 | [FLOW-201](#flow-201) | Split rows inside the assign_expenses batch | MCP | done (#73) |
| 5 | [FLOW-202](#flow-202) | sync_bank returns before slow MCP clients time out | MCP | done (#75) |
| 6 | [FLOW-105](#flow-105) | Link a loan to a project (server and MCP) | SMALL CYCLE | done (#89) |
| 7 | [FLOW-311](#flow-311) | Split one bank line across several categories | MCP | done (#87) |
| 8 | [FLOW-602](#flow-602) | Rename a company (RPC and MCP merged; screen next) | SMALL CYCLE | done (#82) |
| 9 | [FLOW-603](#flow-603) | Per-user cache isolation on a shared device | BUG | done (#79) |
| 10 | [FLOW-112](#flow-112) | Kept-out categories follow-ups (#67 review) | BACKLOG NIT | done (#81) |
| 10b | [FLOW-121](#flow-121) | Kept-out lines: guessed categories and project income | SMALL CYCLE | done (#113) |
| 10c | [FLOW-122](#flow-122) | Loan categories by key in the app and the Mercury hint | SMALL CYCLE | done (#112) |
| 10d | [FLOW-126](#flow-126) | Kept-out guesses follow-ups (#113 review) | BACKLOG NIT | done (#114) |
| 10e | [FLOW-127](#flow-127) | Kept-out income and overhead undo review follow-ups (#114, #116 reviews) | BACKLOG NIT | done (#117) |
| 11 | [FLOW-204](#flow-204) | assign_expense_split follow-ups (#68 review) | BACKLOG NIT | done (#88) |
| 12 | [FLOW-203](#flow-203) | get_project docs and list_projects basis echo (#66 review) | BACKLOG NIT | done (#90) |
| 13 | [FLOW-116](#flow-116) | Overhead project follow-ups (#71 review) | BACKLOG NIT | done (#116) |
| 13b | [FLOW-128](#flow-128) | Unpaid supplier invoices on the cash basis | SMALL CYCLE | done (#118) |
| 13c | [FLOW-206](#flow-206) | Bulk setup without rate-limit stalls | MCP | done (#119) |
| 14 | [FLOW-509](#flow-509) | Mercury connector hardening (#44, #52, #64 reviews) | BACKLOG NIT | done (#91) |
| 15 | [FLOW-902](#flow-902) | Replace the deny-listed supplier word | BACKLOG NIT | ready |
| 16 | [FLOW-901](#flow-901) | Deny-list test coverage gaps | SMALL CYCLE | ready |
| 17 | [FLOW-107](#flow-107) | Loan split breakdown on the transaction | SMALL UI | done (#83) |
| 18 | [FLOW-511](#flow-511) | Easy opt-out from the Home setup card | PLAN FIRST | done (#95) |
| 19 | [FLOW-113](#flow-113) | Kept-out toggle on the categories screen | SMALL UI | done (#86) |
| 20 | [FLOW-301](#flow-301) | Income and expense drill-down from Home | PLAN FIRST | done (PR #85, 2026-10-07; option A approved by the owner) |
| 21 | [FLOW-302](#flow-302) | Month dividers in every transaction list | SMALL UI | done (#98) |
| 22 | [FLOW-303](#flow-303) | Previous and next on the transaction card | SMALL UI | done (#100) |
| 23 | [FLOW-108](#flow-108) | Take a single transaction out of the P&L, with an MCP batch | PLAN FIRST | done (#105) |
| 24 | [FLOW-103](#flow-103) | One P&L basis for the app and MCP totals | SMALL CYCLE | on-hold |
| 25 | [FLOW-106](#flow-106) | More loan types and loan fields | PLAN FIRST | done (MCP side: #132 #151 #157 #162; screen fields with the UI lane) |
| 26 | [FLOW-701](#flow-701) | Jev phase 1 | PLAN FIRST | done (parts 1-4: #137, #143, #149, #160) |
| 27 | [FLOW-501](#flow-501) | Tabs reorg: connectors and loans pages | PLAN FIRST | done (#111) |
| 28 | [FLOW-604](#flow-604) | rename_company follow-ups (#77 review) | BACKLOG NIT | done (#120) |
| 29 | [FLOW-117](#flow-117) | Reversal section in the category picker | SMALL UI | done (#101) |
| 30 | [FLOW-118](#flow-118) | Reversals follow-ups (#76 review) | BACKLOG NIT | done (#122) |
| 31 | [FLOW-119](#flow-119) | Project picker in the loan sheet | SMALL UI | done (#104) |
| 32 | [FLOW-120](#flow-120) | Loan project follow-ups (#89 review) | BACKLOG NIT | done (#121; UI items go to the design PR, #121 review items to FLOW-129) |
| 32b | [FLOW-129](#flow-129) | Loan attach follow-ups (#121 review) | BACKLOG NIT | done (#123) |
| 32c | [FLOW-130](#flow-130) | Lock timeouts return retry in every MCP write (#123 review) | BACKLOG NIT | done (#124) |
| 33 | [FLOW-208](#flow-208) | Split and undo follow-ups (#88 review) | BACKLOG NIT | done (#122) |
| 34 | [FLOW-605](#flow-605) | Shared-device follow-ups (#79 review) | BACKLOG NIT | done (#131) |
| 34b | [FLOW-606](#flow-606) | Company name rule in create_company and the rename sheet | BACKLOG NIT | done (#131, #134) |
| 35 | [FLOW-209](#flow-209) | get_project follow-ups (#90 review) | BACKLOG NIT | done (#126) |
| 36 | [FLOW-125](#flow-125) | Loan split follow-ups (#83 review) | BACKLOG NIT | done (#253) |
| 37 | [FLOW-123](#flow-123) | Loan balance checks follow-ups (#72 review) | BACKLOG NIT | done (#127) |
| 37b | [FLOW-131](#flow-131) | Loan balance checks follow-ups (#127 review) | BACKLOG NIT | done (#129, #134) |
| 37c | [FLOW-312](#flow-312) | Split-by-category follow-ups (FLOW-311) | BACKLOG NIT | done (#133, #136, #145) |
| 37d | [FLOW-133](#flow-133) | Batch undo by write id; split undo keeps percent and rest (#145 review) | BACKLOG NIT | done (#155) |
| 37e | [FLOW-132](#flow-132) | Closed loan follow-ups (#132 review) | BACKLOG NIT | done (#162) |
| 37f | [FLOW-134](#flow-134) | Loan part categories follow-ups (FLOW-106 part 2 review) | BACKLOG NIT | done (#242) |
| 37g | [FLOW-135](#flow-135) | Loan installments follow-ups (FLOW-106 part 3 review) | BACKLOG NIT | done (#162) |
| 37h | [FLOW-136](#flow-136) | Loan kinds follow-ups (part 4 review) | BACKLOG NIT | done (#193) |
| 38 | [FLOW-313](#flow-313) | Month dividers follow-ups (#98 review) | BACKLOG NIT | done (#242) |
| 39 | [FLOW-314](#flow-314) | Swipe between transactions on the card | SMALL UI | ready |
| 40 | [FLOW-124](#flow-124) | One line out of the P&L follow-ups (#105) | SMALL UI | done (#253, #248) |
| 41 | [FLOW-319](#flow-319) | Type sizes, headers and text colours, income in green | SMALL UI | done (#111) |
| 42 | [FLOW-320](#flow-320) | Open the picker that was tapped on the transaction detail | SMALL UI | done (#125) |
| 43 | [FLOW-410](#flow-410) | Find every project in project search | BUG | done (#128) |
| 44 | [FLOW-321](#flow-321) | Two rows in Home's attention card (review and unpaid) | SMALL UI | done (#130) |
| 45 | [FLOW-322](#flow-322) | Copy and dead-end fixes from the UX review | SMALL UI | ready |
| 46 | [FLOW-411](#flow-411) | Project screen: lines on open, honest period label | SMALL UI | done (#199) |
| 47 | [FLOW-323](#flow-323) | Search and all transactions | PLAN FIRST | done (#210), with FLOW-402 |
| 48 | [FLOW-324](#flow-324) | Approve all suggestions in the review queue | PLAN FIRST | dropped (owner, 2026-10-08) |
| 49 | [FLOW-325](#flow-325) | Split a refund across projects and categories by percent or amount | MCP | in-progress (server done; app screen first PR merged #150; follow-ups open) |
| 50 | [FLOW-326](#flow-326) | Screen titles and row text on the start side | SMALL UI | done (#165) |
| 51 | [FLOW-327](#flow-327) | Review card: actions in the thumb zone, tidy spacing | SMALL UI | done (#175) |
| 52 | [FLOW-328](#flow-328) | Mobile UI consistency pass (cycle 1) | SMALL UI | done (#165; whole-unit amounts item open, conflicts with 0120) |
| 53 | [FLOW-329](#flow-329) | Out of the P&L as a visible row on the transaction | SMALL UI | done (#248) |
| 54 | [FLOW-330](#flow-330) | Mark paid that stays marked | SMALL CYCLE | done (#199; server and MCP #163) |
| 55 | [FLOW-331](#flow-331) | A useful + tab while capture is not built | SMALL UI | claimed (UI lane 4, 2026-10-08) |
| 56 | [FLOW-332](#flow-332) | Swipe back from the edge on pushed screens | SMALL UI | merged (#238) |
| 57 | [FLOW-333](#flow-333) | Split editor and split review card follow-ups (cycle 3) | SMALL UI | C13 open (C1–C9 done: UI lane 2, #261) |
| 58 | [FLOW-334](#flow-334) | Stacked header follow-ups and phone polish (cycle 4) | SMALL UI | ready (owner chose 2026-10-08) |
| 59 | [FLOW-335](#flow-335) | Period bar, by-month page and Unpaid polish (cycle 5) | SMALL UI | done (#239) |
| 60 | [FLOW-336](#flow-336) | Step the period one-handed | PLAN FIRST | done (#239; owner chose the swipe, 2026-10-08) |
| 61 | [FLOW-337](#flow-337) | A period on the "לפי חודש" page | PLAN FIRST | done (#239; owner chose the whole project, 2026-10-08) |
| 62 | [FLOW-706](#flow-706) | Jev fills can't be undone from the app while Jev is off | BUG | claimed (UI lane 4, 2026-10-09) |

Everything else follows by area, roughly in priority order inside each area.

## P&L and loans

<a id="flow-102"></a>
### FLOW-102 · Unassigned bucket, overhead project, unpaid row on the invoiced basis
- **Type:** SMALL CYCLE · **Status:** done (#71) · **Depends on:** —
- **What:** Three P&L gaps found while cleaning real data. (1) Lines with no project, shared split or overhead role drop out of direct + shared + overhead, so the parts don't add up to the company total. Return an `unassigned` bucket in `company_pnl`, `get_project` callers and the MCP totals. (2) Let a company mark one project as its overhead project, so lines filed there count as overhead, not as direct cost (today overhead reads 0 for a company that files overhead into a project). (3) An unpaid expense row is left out on the invoiced basis; review the rule against [calculations](../module-1-project-pnl/calculations.md) and fix or document it.
- **MCP:** totals tools return the unassigned bucket; a write tool to set or clear the overhead project (idempotency key, write bucket, undo).
- **Acceptance:** pgTAP: projects + overhead + unassigned = company total on both bases, ILS and USD; the overhead project's lines move from direct to overhead and back on undo; cross-tenant refusal with a positive control; the unpaid-row rule has a test either way. Decision and changelog.

<a id="flow-109"></a>
### FLOW-109 · Income assigned to a project: confirm it counts in that project
- **Type:** BUG · **Status:** done (#74) · **Depends on:** —
- **What:** Income filed to a project through MCP `assign_expense` gets no allocation row and a null `pnl_role`, while expenses filed the same way get a 100% allocation with role `project`. Verify whether that income counts in the project's P&L; if not, fix `assign_expense` (and the batch path) for income.
- **Acceptance:** pgTAP: income assigned to project A shows in A's `get_project` income and in the company total exactly once; undo removes it; MCP test for the income path.

<a id="flow-111"></a>
### FLOW-111 · update_loan can store a payment below the interest
- **Type:** BUG · **Status:** done (#72) · **Depends on:** —
- **What:** MCP `update_loan` doesn't re-check the schedule, so a client can store a payment smaller than the interest, after which `get_loan_schedule` and `attach_loan_payment` throw uncaught. Validate in SQL and return a fixed refusal. In the same PR: trim the name and treat explicit nulls correctly, give a specific refusal for bad parts, add a DB balance check for the app split path, make `loan_split` undo refuse (conflict) when the split was corrected in the app afterwards, cap the currency-default read (the app reads at most 1000 lines), and add `set local lock_timeout` to the migration.
- **Acceptance:** tests for each refusal and for undo after an app correction; existing loan tests unchanged.

<a id="flow-123"></a>
### FLOW-123 · Loan balance checks follow-ups (#72 review)
- **Type:** BACKLOG NIT · **Status:** done (#127) · **Depends on:** #72
- [x] `private.loan_splits_check` does not lock the loan, so two app splits on the same loan at once can both pass the balance check (the MCP path locks it). (#127: it locks the loan row first.)
- [x] The balance check runs only when splits change. A line that becomes posted, a removed line that comes back, or an edit that lowers the principal below what was paid can still take `loan_balances` below zero. (#127, decision [0121](../decisions/0121-loan-balance-checks.md): such a line's parts are flagged for review; a principal below what was paid is refused.)

<a id="flow-131"></a>
### FLOW-131 · Loan balance checks follow-ups (#127 review)
- **Type:** BACKLOG NIT · **Status:** done (#129, #134) · **Depends on:** FLOW-123 (#127)
- [x] MCP `list_loans` returns only `balance_minor`, so the data agent cannot see a payment the bank sync flagged for review. Return `flagged_parts` (or the flagged transaction ids). (#129: both, migration `20261008080000`.)
- [x] A line posted while another write holds the loan is flagged even when it fits (`skip locked`). The owner has to clear it; consider a hint in the review UI (through the Mercury thread). Handed to the Mercury thread; the MCP side is covered by `flagged_transaction_ids`. (#134: `needs_review` is one boolean with no reason, so a busy loan, a payment past the balance and a re-synced amount look the same; the split card says "ייתכן שהתשלום סומן כי נרשם בזמן עדכון אחר של ההלוואה. עדכון החלוקה יבדוק את היתרה מחדש." above עדכון החלוקה, and a refused re-check toasts "התשלום גבוה מיתרת ההלוואה.". UI only.)
- [x] The lock order is checked by hand with two sessions. Add a two-session pgTAP test (dblink) if CI has it. (#129: `loan_lock_order.test.sql`.)

<a id="flow-112"></a>
### FLOW-112 · Kept-out categories follow-ups (#67 review)
- **Type:** BACKLOG NIT · **Status:** done (#81) · **Depends on:** —
- [x] Default names: near-variant category names aren't matched, and a rename doesn't re-check the default. (#81: `private.pnl_name_key`; the trigger also runs on a rename into a default name.)
- [ ] A merely suggested kept-out category already removes the line from the P&L. Moved to [FLOW-121](#flow-121).
- [ ] `get_project` doesn't report kept-out project income. Moved to [FLOW-121](#flow-121).
- [x] Document the change in what `count` means in the P&L outputs. (#81, TOOLS.md)
- [x] An owner who is also a viewer is refused by `set_category_excluded_from_pnl`. (#81)
- [x] The default loan categories match by Hebrew name in several places (loan split check, income review filter, loan trigger). Move to a stable key or flag. (#81: `categories.loan_part` in the database checks; the app split sheet and the Mercury hint move in [FLOW-122](#flow-122).)

<a id="flow-121"></a>
### FLOW-121 · Kept-out lines: guessed categories and project income
- **Type:** SMALL CYCLE · **Status:** done (#113) · **Depends on:** FLOW-102 (#71), FLOW-104 (#76), both merged; they rewrote `private.pnl_lines` and `get_project`
- **What:** Split out of FLOW-112. (a) A guessed (`category_suggested`) kept-out category already takes the line out of the P&L. Owner decision asked 2026-10-07; the recommended answer is that a guess counts in the P&L until the category is confirmed. (b) `get_project` lists kept-out project expenses in `excluded_categories_by_currency` but not kept-out project income.
- **Acceptance:** the owner's answer to (a) written here; pgTAP for both bases; TOOLS.md for `get_project` and `get_totals`.
- **Answer to (a):** built as recommended, a guess counts until confirmed (decision [0114](../decisions/0114-kept-out-guesses.md)); the owner was asked again on 2026-10-07 and can still pick the other way.

<a id="flow-126"></a>
### FLOW-126 · Kept-out guesses follow-ups (#113 review)
- **Type:** BACKLOG NIT · **Status:** done (#114) · **Depends on:** FLOW-121
- [x] Income that already has a project and a guessed kept-out category is never queued for review, so the guess is never confirmed and the line keeps counting. Owner call: queue a guessed kept-out category for income too, or leave it. (#114: queued with reason `suggested`, the recommended answer; the owner was asked on 2026-10-07 and can still pick "leave it".)

<a id="flow-127"></a>
### FLOW-127 · Kept-out income and overhead undo review follow-ups (#114, #116 reviews)
- **Type:** BACKLOG NIT · **Status:** done (#117) · **Depends on:** FLOW-126 (#114), FLOW-116 (#116)
- [x] `20261007224500_kept_out_income_review.sql`: the `user_assigned` / `category_assigned` checks next to `category_suggested` are redundant. Drop them in the next migration that replaces the function, or add a comment saying why they stay. (Kept with a comment: not every owner write clears `category_suggested`.)
- [x] The same review queue can pick up a guessed loan category. Skip it through `private.line_category_out`, as the other review paths do.
- [x] [TOOLS.md](../mcp/TOOLS.md): say that `set_expense_category` keeps the line's project.
- [x] #116 review: `private.overhead_share` has one mis-indented `in_pnl` line.
- [x] #116 review: `undo` kind `overhead_project` checks that the prior project still exists without locking it, so a delete at the same moment turns `conflict` into `refused`. Lock it with `for key share`.
- [x] #116 review: `overhead_project_undo_deleted.test.sql` has two no-op `as_mcp()` / `reset role` pairs before the deletes.

<a id="flow-122"></a>
### FLOW-122 · Loan categories by key in the app and the Mercury hint
- **Type:** SMALL CYCLE · **Status:** done (#112) · **Depends on:** FLOW-112 (#81); FLOW-304 (#107), whose `upsert_connector_lines` this PR's migration builds on
- **What:** Follow-up from FLOW-112. `app/src/screens/loan-match.tsx` reads the three loan categories with `.in("name", ...)` and offers a match when the line's category name equals the principal name; the Mercury connector's loan hint resolves `תשלומי הלוואה` by name; the categories screen's locked loan line (`loanCategoryLine` in `app/src/screens/categories-screen.tsx`, FLOW-113) matches the Hebrew names too. Read `categories.loan_part` instead. No visible change.
- **Acceptance:** app unit test with a renamed loan category; connector test; no design review needed.

<a id="flow-113"></a>
### FLOW-113 · Kept-out toggle on the categories screen
- **Type:** SMALL UI · **Status:** done (#86) · **Depends on:** FLOW-101 (merged)
- **Owner approval:** 2026-10-07, option A (row sheet button, ⊘ mark, save on tap with ביטול). Decision [0106](../decisions/0106-kept-out-toggle.md).
- **What:** The per-category P&L flag exists only through the API and MCP. Smallest option: one secondary action in the category row's "עוד" sheet next to הסתרה ("מחוץ לרווח והפסד" / "החזרה לרווח והפסד") plus a muted icon on kept-out rows with a Hebrew aria-label. On `/settings/categories`, not on Settings itself. The three loan categories stay fixed.
- **Acceptance:** mockup approved; CONTROLS.md row; design review.

<a id="flow-116"></a>
### FLOW-116 · Overhead project follow-ups (#71 review)
- **Type:** BACKLOG NIT · **Status:** done (#116) · **Depends on:** —
- [x] `private.overhead_share` counts the overhead project's own income in the weights, so the overhead project gets a share of overhead. (#116: left out, share 0, the recommended answer; owner asked 2026-10-07 by card. Decision [0117](../decisions/0117-overhead-project-weights.md).)
- [x] `undo` kind `overhead_project` after the prior overhead project was deleted is `refused` / `project not found`; `conflict` would match the other undo kinds. (#116)
- [ ] Cash-basis expenses count an unpaid supplier invoice by document date. Moved to [FLOW-128](#flow-128).

<a id="flow-128"></a>
### FLOW-128 · Unpaid supplier invoices on the cash basis
- **Type:** SMALL CYCLE · **Status:** done (#118) · **Depends on:** —
- **What:** Split out of FLOW-116. On the cash basis an expense line counts by its document date, so a posted supplier invoice that is not paid yet counts, which [0007](../decisions/0007-bank-statement-is-primary-input.md) does not intend (follow-up named in [0101](../decisions/0101-unassigned-and-overhead-project.md)). Decide the rule (count by payment date, or leave unpaid invoices out of the cash basis) and apply it in `private.pnl_lines` so every P&L read follows.
- **Acceptance:** decision; pgTAP on both bases for a paid and an unpaid supplier invoice; TOOLS.md and calculations.md updated.
- **Answer:** an unpaid supplier invoice stays out of the cash basis; other expenses keep their document date (decision [0118](../decisions/0118-unpaid-invoices-cash-basis.md)). Built as recommended; the owner was asked on 2026-10-08 and can still pick "count by payment date".

<a id="flow-107"></a>
### FLOW-107 · Loan split breakdown on the transaction
- **Type:** SMALL UI · **Status:** done (#83) · **Depends on:** FLOW-101 (merged, #70)
- **Approved:** owner chose option A of the [mockups](https://claude.ai/artifact/MSVfZhxN56T2V6epZaQ25v) on 2026-10-07 (parts list with icons, minus, total, "מחוץ לרווח", "נספר ברווח"; list rows "3 חלקים"). Decision [0107](../decisions/0107-loan-split-on-the-transaction.md).
- **What:** When a bank line is a split loan payment, show its parts (principal, interest, escrow) on the transaction row and in the detail, so the expense makes sense. Icon-based, minimal wording, expenses with a minus. MCP: `get_expense` returns the split parts.
- **Acceptance:** quick mockup approved; parts add up to the line amount on screen; MCP test; design review.

<a id="flow-125"></a>
### FLOW-125 · Loan split follow-ups (#83 review)
- Renumbered from a second FLOW-121 (2026-10-07).
- **Type:** BACKLOG NIT · **Status:** done (#253) · **Depends on:** FLOW-107
- [x] (UI lane 3, 2026-10-08: the category drill-down, the project list, שויכו היום, a project's לאישור list and the breakdown lines pass the line's source through `rowSource`, so a Mercury line shows the bank icon) Transaction rows in the category drill-down, a project's recent list and "שויכו היום" always pass `source="invoice"` (`app/src/screens/project-category-screen.tsx`, `project-detail-screen.tsx`, `filed-today-screen.tsx`), so bank lines show the document icon. Have the list reads return the line's source and pass it on; do not special-case loan rows.
- [x] (UI lane 3, 2026-10-08: `ListRow` runs a Latin string title LTR, aligned to the row's start side, with or without a tag) A Latin row title is cut at its start in an RTL row at 320 ("…gate Home Loans"). Use `dir="auto"` on `.ui-row-title`, or `ltrTitle` when the description is Latin.
- [x] (UI lane 3, 2026-10-08: `useLoanMarks` counts the loan_splits rows of each line, and the hint says "2 חלקים", "3 חלקים", …) "3 חלקים" is a fixed string (`app/src/screens/loan-marks.tsx`). Carry the real part count in the mark if a split can ever have fewer or more parts.

<a id="flow-108"></a>
### FLOW-108 · Take a single transaction out of the P&L, with an MCP batch
- **Type:** PLAN FIRST · **Status:** done (#105) · **Depends on:** #67 (merged)
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/QPLXZjbEdoy8x2H49EEuYS) (עוד sheet button, ⊘ pill, save on tap with ביטול; loan lines locked), under the owner's standing rule for UI tasks. Decision [0112](../decisions/0112-line-out-of-pnl.md).
- **What:** Let the user move one expense or income line out of the P&L. It then shows in a visible "out expenses" / "out income" group (not hidden), and can move back anytime. A per-transaction override wins over the category default. MCP: a single tool and a batch tool to take out or restore many lines at once, with idempotency, the write bucket, `undo` and `undo_batch`; plus an API. Icon-based, minimal wording.
- **Acceptance:** plan and mockup approved by the owner, then: pgTAP for override precedence on both bases, totals moved to the excluded side, batch partial success and batch undo.

<a id="flow-124"></a>
### FLOW-124 · One line out of the P&L follow-ups (#105)
- **Type:** SMALL UI · **Status:** done (item 1 #253; items 2 and 3 #248; server #176) · **Depends on:** FLOW-108 (#105)
- [x] (UI lane 3, 2026-10-08, for the category drill-down, שויכו היום and a project's לאישור list: the shared `KeptOutTag` ⊘ through `ListRow` `tag`; the project list already says "מחוץ לרווח" in its hint, and every breakdown line in the excluded view is out, so it gets no ⊘) (server done in #176: the list reads return `kept_out`, [0135](../decisions/0135-line-state-in-lists.md); the ⊘ `tag` is the UI part) Transaction lists (project recent list, category drill-down, לאישור, שויכו היום, breakdown lines) don't mark a line taken out of the P&L. Return the flag from the list reads and show the ⊘ mark through `ListRow` `tag`, like the categories screen.
- [x] (server done in #176: `get_transaction` returns `pnl_state` `in`/`out`/`mixed`; driving the pill and hint from it is the UI part; done in #248: a mixed line shows "חלקית ברווח" and a split-by-category hint, a line kept out by its parts shows the kept-out pill and comes back in with true; a loan line keeps its lock) A line split by category: `get_transaction`'s `in_pnl`, `category_excluded_from_pnl` and `pnl_fixed` read the line's own category, not its parts, and the card works out `out` from the override and that flag instead of the server's `in_pnl`. A split line whose parts are partly kept out shows no pill and the hint names the line's category. Return a per-line state for split lines (all in, all out, mixed) and drive the pill and hint from it.
- [x] Stories: open the עוד sheet with a play function so clip-check measures its text, and add the other states: category kept out (hint names it), a line forced back in ("ברווח והפסד" pill), the locked loan line, and the split-line hint. (#248: the hints now sit on the card's switch row; stories `TransactionPnlCategoryOut`, `TransactionPnlForcedIn`, `TransactionPnlLoanLine`, `TransactionPnlMixed`, and `TransactionManualMore` opens ⋯.)

<a id="flow-103"></a>
### FLOW-103 · One P&L basis for the app and MCP totals
- **Type:** SMALL CYCLE · **Status:** on-hold (owner decision) · **Depends on:** —
- **What:** The app shows the invoiced basis ([0060](../decisions/0060-library-review-calls.md)) while MCP `get_totals`, `list_projects` and `get_project` default to cash. Proposal: move all three to invoiced together, so the tools never disagree with each other. It changes behaviour for existing MCP clients. Also decide what to do with `get_home` (cash, only used at sign-in): align it or remove it.
- **Acceptance:** owner decision recorded; one PR switches the defaults together, tools echo the basis, TOOLS.md updated.

<a id="flow-105"></a>
### FLOW-105 · Link a loan to a project
- **Type:** SMALL CYCLE · **Status:** done (#89, server and MCP); the loan sheet picker is [FLOW-119](#flow-119) · **Depends on:** —
- **Owner's go:** 2026-10-07, in the project thread (taken off hold).
- **What:** Optional `loans.project_id` (FK, RLS, migration), settable in MCP `add_loan` / `update_loan` (idempotency, undo, RPC). Show the loan under its project; attached payment splits inherit the loan's project.
- **Acceptance:** cross-tenant project refusal with a positive control; split inheritance tested; undo restores.

<a id="flow-117"></a>
### FLOW-117 · Reversal section in the category picker
- **Type:** SMALL UI · **Status:** done (#101) · **Depends on:** FLOW-104 (done, #76)
- **Approval:** 2026-10-07, design reviewer's option A (a closed section under the list), built under the owner's standing rule for UI tasks.
- **What:** The server accepts the other kind's category since FLOW-104. In the app category picker, list the other kind's categories under a "reversal" section, so a bounced rent payment or a supplier refund can be filed from the app.
- **Acceptance:** mockup approved; e2e picks a reversal category both ways; design review.

<a id="flow-118"></a>
### FLOW-118 · Reversals follow-ups (#76 review)
- **Type:** BACKLOG NIT · **Status:** done (#122) · **Depends on:** FLOW-104
- [x] `approve_split_review` still raises 'category kind must match the direction' for a null kind; the branch is unreachable after 'category is required'. Drop it or give it its own message. (#122: 'category not found'; the composite foreign key keeps it unreachable.)
- [x] The `private.mcp_refused` whitelist still carries that message; remove it when the whitelist is next edited. (#122: kept. `mcp_assign_expense_split` and `save_line_split` still raise it.)
- [ ] A reversal on a line with shares counts as company income with no project. Owner call: spread it over the shares, or refuse an income-kind category on a shared line.
- [ ] (#101 review) Overhead lines (`pnl_role` overhead) still offer the picker's reversal section; settle with the shared-line call above. Split and shared lines don't offer it.
- [x] (in #111) A hidden, loan or kept-out other-kind category already on a line (filed through MCP) shows החזר on the review card but sits in the own-kind list with no mark in the change sheet.
- [ ] (#101 review) The picker's search shows above 8 own-kind categories only; consider counting the reversal section too.
- [ ] (#101 review) If a suggestion can ever be of the other kind, the summary shows הצעה, not החזר. Rules never learn reversals today.

<a id="flow-119"></a>
### FLOW-119 · Project picker in the loan sheet
- **Type:** SMALL UI · **Status:** done (#104; design reviewer's option A, built under the owner's standing UI rule; plan in the PR body) · **Depends on:** FLOW-105
- **What:** Pick or clear the loan's project in the loan sheet, and show the loan under its project.
- **Acceptance:** mockup approved; e2e sets and clears the project; design review.

<a id="flow-120"></a>
### FLOW-120 · Loan project follow-ups (#89 review)
- **Type:** BACKLOG NIT · **Status:** done (#121; the three design-review items go to the design PR, the two #121 review items moved to FLOW-129) · **Depends on:** FLOW-105
- [x] Attaching a payment to an unassigned line with a suggested category confirms that category and closes its review item. Decide whether inheritance should skip suggested categories or keep the suggestion flag. (#121: skipped, reason `line category is a guess`; the owner was asked and can still pick "keep the flag".)
- [x] An error inside `reassign_transaction` refuses the whole attach; fall back to `project_inherited: false` instead. (#121: reason `project not set`.)
- [x] The app's own loan split path does not inherit the loan's project; only MCP `attach_loan_payment` does. Cover it with FLOW-119 or say so in 0104. (#121: said so in 0105.)
- [x] A line under an income (reversal) category is not restored by the attach undo (its role is not `project`). Test the role guard in that undo. (#121: the attach keeps the role it gave the line and undo checks that role, so such a line is restored; tested both ways.)
- [x] (#104 design review, in #111) Show project codes in the loan project picker once the dashboard projects carry `code`, with the "חיפוש פרויקט או קוד" placeholder.
- [x] (#104 design review, in #111) Keep the loan sheet's height when it swaps between the form and the project picker; wrap the loan-project stories in a sheet-like decorator.
- [x] (#104 design review, in #111) CONTROLS.md: note the static loan rows on the project screen.
- [x] The attach keeps `reassign_id` inside `mcp_writes.prior` although the table has a `reassign_id` column. (#121; undo still reads older writes from `prior`.)
- [x] Add a pgTAP test for a viewer updating their own company's loan through the table; the current test is cross-company. (#121, `loan_project_followups.test.sql`.)
- [ ] (#121 review) Two review items moved to [FLOW-129](#flow-129).

<a id="flow-129"></a>
### FLOW-129 · Loan attach follow-ups (#121 review)
- **Type:** BACKLOG NIT · **Status:** done (#123) · **Depends on:** FLOW-120
- [x] `mcp_attach_loan_payment` and `mcp_undo` send `lock_not_available` to `others`, so the refusal is stored under the idempotency key and a retry replays it. Map it to `unavailable` / `retry` like a deadlock. (Migration `20261008043000`, tested in `loan_project_followups_reraise.test.sql`.)
- [x] `loan_project_followups.test.sql` queues g1's review item only if the trigger did not; assert what the trigger does instead. (No trigger queues it; the test asserts that and inserts the item.)

<a id="flow-130"></a>
### FLOW-130 · Lock timeouts return retry in every MCP write (#123 review)
- **Type:** BACKLOG NIT · **Status:** done (#124) · **Depends on:** FLOW-129
- [x] The other `mcp_*` write functions still send `lock_not_available` to `others`, so a lock timeout is stored as a refusal under the idempotency key. Map it to `unavailable` / `retry` in each, as #123 did for `attach_loan_payment` and `undo`, and update TOOLS.md. (Migration `20261008050000`, 18 tools, tested in `mcp_lock_retry.test.sql`.)

<a id="flow-132"></a>
### FLOW-132 · Closed loan follow-ups (#132 review)
- **Type:** BACKLOG NIT · **Status:** done (#162) · **Depends on:** FLOW-106 part 1 (#132)
- [x] A removed line dated after a loan's `closed_on` keeps its parts; if it comes back it counts against the closed loan without a check. Check it when the line is restored, as decision 0121 does for the balance. (Its parts are flagged for review, and clearing the review checks again: migration `20261010090000`, decision 0132.)
- [x] Changing an attached line's `doc_date` to after its loan's `closed_on` is not checked. (Flagged for review the same way: migration `20261010090000`, decision 0132.)
- [x] `get_project`'s `loans[]` has no `status`, so a project lists paid-off and closed loans next to open ones. (`loans[]` has `status`, `closed_on` and `kind`: migration `20261010090000`, decision 0132.)

<a id="flow-134"></a>
### FLOW-134 · Loan part categories follow-ups (FLOW-106 part 2 review)
- **Type:** BACKLOG NIT · **Status:** done (#242) · **Depends on:** FLOW-106 part 2
- [x] `merge_category` does not move `loans.*_category_id`, so a loan keeps filing new parts under the hidden source category. Move them in the merge (the target must fit the part) or refuse the merge. (Moved when the target fits, else the merge is refused: migration `20261010090000`, decision 0132.)
- [x] The categories screen shows a generic error when a flip is refused with `loan category is fixed` for a category a loan uses; give it copy (Mercury UI thread). (`pnlFailureText` in `category-copy.ts`.)
- [x] The match sheet offers a loan only for lines on the keyed principal category (`offerMatch` in `loan-match.tsx`); also offer it on a loan's own principal category (Mercury UI thread). (`LoanTransactionSplit` takes the line's `categoryId` and offers שיוך when a loan's principal category is that category.)
- [x] `mcp_update_loan` repeats the fit check for each part; one loop over the three keys would do. The loans trigger also runs on every `update_loan` and `loan_update` undo, since they always set the three columns. (One loop over the four keys; the update trigger runs only when a part category changes: migration `20261010090000`, decision 0132.)
- [x] (from #248 review, not a bug) `get_transaction`'s `pnl_fixed` is already `loan_part is not null or exists (loan_splits)` (since `20261007210000`); pgTAP `line_state_in_lists` covers a loan payment on a plain category.

<a id="flow-135"></a>
### FLOW-135 · Loan installments follow-ups (FLOW-106 part 3 review)
- **Type:** BACKLOG NIT · **Status:** done (#162) · **Depends on:** FLOW-106 part 3
- [x] N1. `attach_loan_payment` `installments` finds the first unpaid row from the principal already paid: a part-paid row counts as unpaid; extra principal paid ahead skips rows; a row with zero scheduled principal always counts as paid; and pending lines do not lower the balance, so two quick installment attaches before the first line posts start on the same row. (The first unpaid row now compares interest plus principal attached, pending lines included: `paidInterestAndPrincipal` in `loan-split.ts`, decision 0132.)
- [x] N3. Exact `parts` still need a schedule row for the line's date (`no schedule row for this date`), although the scheduled figures are only kept for comparison. (Accepted with scheduled figures of 0, decision 0132.)

<a id="flow-136"></a>
### FLOW-136 · Loan kinds follow-ups (part 4 review)
- **Type:** BACKLOG NIT · **Status:** done (#193) · **Depends on:** FLOW-106 part 4
- [x] `private.loan_line_closed_check` flags an open loan's line parts when another write holds the loan lock (skip locked finds nothing). The new `doc_date` trigger widens this to pending lines and any date change. Read the status without a lock first, and return when the loan is open. (Migration `20261010120000`.)
- [x] `balloon` in the schedule ignores a payment entered by hand below the annuity on `interest_only` and `balloon` loans. Also, when `interest_only_months` equals the term, `list_loans` shows the bullet amount as `payment_minor`. (Flagged unless a rate change recast it; `list_loans` shows interest plus escrow.)
- [x] Nothing in the database checks that `loan_rates.effective_date` is on or after the loan's start: row level security lets an authenticated user insert a row directly. Add a check (a trigger, since the start is on `loans`). (Triggers on `loan_rates` and on a later `loans.start_date`: migration `20261010120000`.)
- [x] Screens plan gaps 1 to 3: `save_loan_split` (the app's atomic loan split write, with `p_preview`), the demand order checks under the loan lock in it and in `mcp_attach_loan_payment`, and `mcp_loan_payments` for a viewer (migration `20261010120000`). Follow-up: once the app writes through `save_loan_split` (Mercury UI thread), revoke direct `loan_splits` insert, update and delete from `authenticated`.
- [x] The app's `correctFailureText` in `loan-match.tsx` does not map `loan_closed` or the `merge_category` refusal; give both copy (Mercury UI thread). (`loan_closed` in `failureText` and `correctFailureText`; the merge refusals in `mergeFailureText`, `category-copy.ts`.)

<a id="flow-106"></a>
### FLOW-106 · More loan types and loan fields
- **Type:** PLAN FIRST · **Status:** done (MCP side: #132 #151 #157 #162; screen fields with the UI lane) · **Depends on:** — · **Owner's approval:** 2026-10-08, the whole plan ("Approve all")
- **What:** Gaps found while setting up real mortgages: (a) balloon, interest-only and demand notes (no term, variable prime-linked rate); (b) a closed or paid-off status for historical loans; (c) attach a payment that includes fees and several missed installments; (d) per-loan category mapping for the split parts instead of the Hebrew defaults. MCP-first for each.
- **Plan (approved):** one PR at a time, MCP first, in this order. Screen fields go to the Mercury UI thread once the MCP side is merged.
  1. (b) `loans.status` (`open`, `paid_off`, `closed`) and `closed_on`, set with `update_loan`; a closed loan takes only payments dated on or before `closed_on`.
  2. (d) Per-loan categories for the parts (null keeps the defaults); interest, escrow and fees go to any expense category in the P&L, principal to one kept out.
  3. (c) A fourth part `fees`; `attach_loan_payment` takes `installments` (1 to 12) or exact `parts` that add up to the line.
  4. (a) `loans.kind` (`amortizing`, `interest_only`, `balloon`, `demand`), a `loan_rates` table and `set_loan_rate`. Demand interest is daily on actual/365; rates are entered by hand. Loan draws are out of scope.
- **Acceptance:** plan approved, then one PR per item with schedule tests at the boundaries.

<a id="flow-110"></a>
### FLOW-110 · Loans list and detail
- **Type:** PLAN FIRST · **Status:** server done (#197, owner chose "unmatch with undo", 2026-10-08); the screens wait for a mockup · **Depends on:** FLOW-501 (where loans live)
- **What:** (1) Reorder loans (persisted order). (2) Edit and delete on each loan, with a confirm for delete. (3) A loan detail page with its attached payments (principal, interest, escrow, fees) linked to the bank rows. MCP: `reorder_loan`, `delete_loan` (update and list exist).
- **Acceptance:** mockup approved; MCP tools with undo.
- [x] Server and MCP: `delete_loan` with `restore_loan` and MCP undo `loan_delete` (payments unmatch, the owner's choice), `reorder_loans` with MCP undo `loan_order`, `list_loans` in the saved order (migration `20261011030000`, decision [0142](../decisions/0142-loan-delete-and-order.md)). Plan: the project's plans/flow-110-loans-server.md.
- [ ] Screens in a UI lane, after a mockup: reorder on the loans list (read `sort_order`), delete with a confirm that names how many payments go back and a toast with ביטול (`restore_loan`), and the payments section of the FLOW-106 detail page (`mcp_loan_payments`).

<a id="flow-114"></a>
### FLOW-114 · Loans server follow-ups
- **Type:** BACKLOG NIT · **Status:** ready (loan match server items done in #184; the loan match UI done in #252; the backfill item open) · **Depends on:** —
- [x] `ratioToPayment` divides by the payment including escrow (`packages/shared/src/loan-schedule.ts`), while the balloon test uses principal and interest only. (Now principal and interest on both sides.)
- [x] `loan_balances.flagged_parts` counts flagged parts on voided or removed lines. (Also `list_loans`' `flagged_transaction_ids`; migration `20261010140000`.)
- [x] Revoke the unnecessary `service_role` EXECUTE grant on `public.clear_loan_split_review`. (Migration `20261010140000`.)
- [ ] Backfill existing loan lines into `loans` / `loan_splits`.
- [ ] Server follow-up from #252: `save_loan_split` takes `category_id` only on the fees part, so an edit of a split, or the undo of an unmatch, files interest, escrow and principal under the loan's categories or the keyed defaults again. Let it accept `category_id` on every part (checked by `private.loan_part_category_ok`, decision 0128), so a part the owner moved to another fitting category keeps it.
- [x] A company with a hidden or kept-out `מסים וביטוח` category fails on escrow. (Obsolete: the default parts resolve by `categories.loan_part`, not by name or visibility.)
- [x] Date formatting for years below 1000. (Four digits, and real leap years for years 0 to 99.)
- [x] Loan match: do the split correction in one server call; check the remaining balance on the server; P&L cache keys after a match; an unmatch flow and a category lock on a matched payment; avoid a split read on every expense view. (Server done: `save_loan_split` writes the split and checks the balance (20261010120000); `clear_loan_split` and MCP `detach_loan_payment` unmatch, and `get_transaction` returns `loan_split` (#184, [0136](../decisions/0136-loan-unmatch.md)). Left for a UI lane: write through `save_loan_split`, an unmatch button through `clear_loan_split`, the P&L cache keys after a match or unmatch, the category picker locked on a matched payment, and reading `loan_split` from the transaction instead of `get_loan_split`.) UI done in #252 (option B, the owner's pick 2026-10-08): the matched payment is one row in the category slot that opens the split sheet; `save_loan_split` for a match, an edit and the undo of an unmatch; `clear_loan_split` for ביטול השיוך with an undo toast; the category locked while matched; the P&L, loan and card keys refreshed after each write; `loan_split` read from `get_transaction`; the balance check's refusal as a toast.
- [x] Follow-up to the owner's call: relax the interest-category check so split interest can use another category (pairs with FLOW-106 d). (FLOW-106 part 2, decision 0128.)

<a id="flow-115"></a>
### FLOW-115 · Loan screens UI follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Loan setup: dim the kept preview when inputs are invalid; a year jump in the date sheet for old start dates; date sheet details per mockup 15b; lock ✕ while saving; error copy that says what to do (and 0 shouldn't read as a missing amount).
- [ ] Loan setup: a slow currency read opens the sheet on "טוען…" and then jumps; the currency read has no limit; add date-sheet and new-state stories and a loading skeleton.
- [ ] Loan match: the waiting line should say why and print only the difference; disable the other rows while the correction is busy; its own failure copy; refresh the parts after a failed correction; next step for a currency mismatch; an empty match sheet offers הלוואה חדשה; hide or disable loans in another currency; long loan names need a second line or hint at 320; whole units on the Settings balances; link the "ממתין לבדיקה" row to the waiting line; skeleton rows to stop cold-open shifts.
- [ ] Loan match sheet: a dismiss during a save should wait for the save; focus stays in the sheet while a loan saves and returns to the row on failure; the error row title for viewers; focus after a successful retry.
- [ ] The split skeleton is sized for the hinted row, so with 2+ loans and no hint the content moves up about 19px on load.
- [ ] Empty state when the only loans are in another currency; a loan without a balance row shows as paid off.

## MCP

<a id="flow-201"></a>
### FLOW-201 · Split rows inside the assign_expenses batch
- **Type:** MCP · **Status:** done (#73) · **Depends on:** #68 (merged)
- **What:** `assign_expense_split` files one line at a time. Allow split rows (`category_id`, `shares[]`) inside `assign_expenses`, counted as one write hit, with per-row results and `undo_batch` restoring the pre-split state (including lines that were in review).
- **Acceptance:** pgTAP and Deno tests for a mixed batch, partial success, replay, and batch undo of a split that closed a review.

<a id="flow-202"></a>
### FLOW-202 · sync_bank returns before slow MCP clients time out
- **Type:** MCP · **Status:** done (#75) · **Depends on:** —
- **What:** A bank pull through `sync_bank` can take about 45 seconds, and clients with a 30-second timeout cut it off. The MCP token also lives 60 seconds while a pull can take 120, so the finish step can fail silently. Start the sync and return a job id, plus a read tool for the job status (or stream progress).
- **Acceptance:** tool returns within a few seconds; status tool reports added, skipped and newest date; the finish step validates the response shape before storing.

<a id="flow-203"></a>
### FLOW-203 · get_project docs and list_projects basis echo (#66 review)
- **Type:** BACKLOG NIT · **Status:** done (#90) · **Depends on:** —
- [x] TOOLS.md: `get_project` is all-time (matches `list_projects` only without dates); `transactions[]` includes pending lines and shows shared lines at full amount; the Mercury both-bases note; `other_currencies` sub-fields with negative expenses.
- [x] `list_projects` should echo `basis`.
- [x] The `get_project` transaction sort needs an id tiebreaker (equal dates sort non-deterministically).

<a id="flow-204"></a>
### FLOW-204 · assign_expense_split follow-ups (#68 review)
- **Type:** BACKLOG NIT · **Status:** done (#88) · **Depends on:** —
- [x] Undo turns a suggested category into a confirmed one (the existing undo functions do this too).
- [x] `closed_review` is reported false when the split closes an `unallocated_shared` review.
- [x] No `lock_timeout` in the migration.
- [x] Reordering the shares counts as different arguments for idempotency.
- [x] No SQL cap on the number of shares.
- [x] Hidden categories and finished projects are accepted.
- [x] Zod `int` / `min` / `strict` cases are untested.
- [x] The cross-tenant code is `refused`, not `not_found` (matches `assign_expense`; decide once for all tools).
- [x] The PR description of #68 is stale; fix it for the record.

<a id="flow-205"></a>
### FLOW-205 · MCP hardening follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [x] Undo ignores `review_queue.prior_*` and `reassign_undo.prior_*` that still point at the row. (Conflict while a prior project, category or share points at it: migration `20261010130000`.)
- [x] Names accept control and invisible characters. (FLOW-205 part 1: project, category and loan names with a control or invisible format character are `validation`; ZWJ stays for emoji.)
- [x] A second hide returns the generic refusal; if the app unhides a category the MCP hid, the MCP can neither re-hide nor undo. (A re-hide keeps the one open undo; undo of a hide the app reversed succeeds: migration `20261010130000`.)
- [x] TOOLS.md conflict wording, and document the `sync_bank` errors.
- [x] `mercury-sync` `deno check` doesn't resolve imports (also on main). (It needs the function's own `--config`; `scripts/check-edge-functions.sh` checks every function that way in local CI and CI, and found a null check in `sumit-connect`.)
- [ ] A post-deploy smoke for `mercury-sync` `auth.getUser()` with an MCP token. (Needs a live MCP token for the sandbox company Flow QA, so it belongs with the Production QA thread's deploy check.)
- [x] `private.mcp_batches` token FK lacks `ON DELETE CASCADE`; the SQL uuid check is lowercase-only while zod accepts any case; `remember` is silently ignored on category-only batch rows. (Cascade added; flow-mcp lowercases ids; `remember: true` on a category-only row is `validation`.)
- [x] A race test (dblink pgTAP or e2e) for the undo row lock. (`mcp_undo_race.test.sql`.)
- [x] Owner fallback in `_shared/owner.ts`: accept it only for flow-mcp tokens, match the token's company claim, share one JWT decoder with `flow-mcp/sign.ts`. (`_shared/jwt.ts`.)
- [x] The MCP review schema still requires `project_id` for kept-out income that doesn't need one. (FLOW-205 part 1: `assign_expense` takes no project for a kept-out income category; any other category without one is `validation`.)
- [x] From the FLOW-205 part 1 review: company names (`rename_company`, `private.company_name_problem`) still accept invisible format characters; the name rule lives only in the MCP layer, so the app RPCs can store look-alike names (a database check would cover both); a refused name says only `validation`, so an agent can't tell to strip a pasted RLM; inner NBSP and other wide spaces look like a normal space. (Migration `20261010160000`: the database refuses hidden characters in project, category, loan and company names and stores wide spaces as plain ones; a refused MCP name says `name has an invisible or control character`.)

<a id="flow-206"></a>
### FLOW-206 · Bulk setup without rate-limit stalls
- **Type:** MCP · **Status:** done (#119) · **Depends on:** —
- **What:** `create_project` and `create_category` hit HTTP 429 after about 10 calls in a row during a company setup. Add batch create tools (like `assign_expenses`) or a higher burst for setup. Also send the MCP `tools/list_changed` notification so clients refresh a stale tool list after a deploy.
- **Acceptance:** a setup of 30 projects and categories runs without a 429; tests for the batch and the notification.

<a id="flow-210"></a>
### FLOW-210 · Bulk setup follow-ups (#119 review)
- **Type:** BACKLOG NIT · **Status:** done (#180) · **Depends on:** FLOW-206 (#119)
- [x] pgTAP: `undo_batch` of a created project or category that a line already uses is `conflict` for that row; `create_projects` with `status: "finished"`. (`bulk_setup_followups.test.sql`.)

<a id="flow-211"></a>
### FLOW-211 · Flow MCP agent requests (2026-10-08)
- **Type:** MCP · **Status:** claimed (dev lane 2, 2026-10-08, claude/project-thread-pz6l1n) · **Depends on:** —
- **What:** from the Flow MCP agent, most important first: (1) `search_expenses` (and `search_transactions`) find a line by its amount, an exact figure or a range, since a bank or HUD figure is the agent's most common lookup; (2) `list_loans` shows each demand loan's accrued unpaid interest as of today, so the agent need not call `get_loan_schedule` per loan; (3) `add_loan` and `update_loan` refuse `company_id` as every tool does (the token decides the company): say so in TOOLS.md.
- **Acceptance:** pgTAP for the amount filter (exact, range, sign, currency); MCP tests for both tools; TOOLS.md.
- [x] `search_transactions` `p_amount_min`/`p_amount_max` and rows with `amount_gross`; MCP `search_expenses` `amount`, `amount_min`, `amount_max` (decision [0155](../decisions/0155-review-list-speed-search-amount.md)).
- [x] `list_loans` `accrued_interest_minor` and `accrued_as_of` for an open demand loan.
- [x] TOOLS.md: no tool takes `company_id`.
- [x] With it, the Production QA bug: `list_review` hit the statement timeout on a 586-line queue. `private.line_pnl_state` is security definer (the company checked in its where clause), `private.line_pnl_states` reads a set of lines at once, and `list_review` reads the lines filed today once.

<a id="flow-207"></a>
### FLOW-207 · sync_bank job follow-ups (#75 review)
- **Type:** BACKLOG NIT · **Status:** done (#156) · **Depends on:** —
- [x] `mcp_sync_bank_finish` accepts any 1–200 character failure message for a known code; allow-list the fixed strings the edge sends, like `mcp_refused`. (Only the fixed pairs `pullBank` sends.)
- [x] `private.mcp_sync_jobs` has no retention; add a cleanup for finished jobs. (`mcp_sync_bank_begin` drops the user's jobs finished over 7 days ago, or running over a day.)
- [x] A handler-level test that `get_sync_status` takes the read rate bucket and that a write-only token can call it through `handle()`.
- [x] Deploy order: between the migration and the edge deploy, a pull's result is lost (the job reads retry after 5 minutes) or `sync_bank` is refused. Note it in the deploy steps.

<a id="flow-208"></a>
### FLOW-208 · Split and undo follow-ups (#88 review)
- **Type:** BACKLOG NIT · **Status:** done (#122) · **Depends on:** —
- [x] `assign_expenses` still hashes `p_items` as sent, so a retried batch with one row's shares in another order is `conflict`; sort split shares before hashing, like `assign_expense_split`. (#122)
- [x] Undo snapshots have no `prior_category_assigned`: a category that was neither a suggestion nor confirmed (supplier rule or provider category) stays confirmed after undo. Add the column to `reassign_undo` and `review_queue` and restore it (see FLOW-205 item 1). (#122; older snapshots keep the old rule. `save_split` still stores no flags.)
- [x] A pgTAP test that undo of a write onto a line with no category lets the trigger fill a fresh guess. (#122, `review_undo_followups.test.sql`.)

<a id="flow-209"></a>
### FLOW-209 · get_project follow-ups (#90 review)
- **Type:** BACKLOG NIT · **Status:** done (#126) · **Depends on:** —
- [x] `transactions[]` rows carry no `line_status`, so a pending row looks the same as a posted one. Add it. (#126)
- [x] `other_currencies` leaves out a shared line whose own `project_id` is this project (`l.project_id is distinct from p.id`), while `by_currency` and `shared_agorot` count it. Check whether any write path stores such rows, then align or document. (#126: no write path stores one, since the app and MCP splits clear `project_id`; aligned anyway.)

## Transactions and app UX

<a id="flow-311"></a>
### FLOW-311 · Split one bank line across several categories
- **Type:** MCP · **Status:** done (#87) · **Depends on:** — · **Owner's go:** 2026-10-07 (bookkeeping requests first: FLOW-104, FLOW-311, FLOW-105, FLOW-106)
- **What:** Today `assign_expense_split` splits a line across projects with one category. Let one bank line split into several parts, each with its own amount (whole minor units), category and project. Needed for a closing wire that mixes a purchase, loan fees, tax prorations and insurance; an inflow that mixes rent and a security deposit (two income categories); and a reimbursement inside a larger payment. Exact minor-unit amounts must be possible, not only whole percents (today a percent split can land a few minor units off the intended amounts). Parts must sum exactly to the line. Parts in kept-out categories stay out of the P&L, the same way loan split parts do ([0100](../decisions/0100-loan-split-pnl.md)).
- **MCP:** a write tool (idempotency key, write rate limit, `undo`) plus the RPC; list it in TOOLS.md. The app screen is a later SMALL UI task.
- **Acceptance:** pgTAP: parts sum to the line or the call is refused; each part counts under its own category and project on both bases, ILS and USD; a kept-out part goes to the excluded totals; mixed income categories on one inflow; undo restores the previous state or refuses if it changed; cross-tenant refusal with a positive control. Decision and changelog.

<a id="flow-133"></a>
### FLOW-133 · Batch undo by write id; split undo keeps percent and rest (#145 review)
- **Type:** BACKLOG NIT · **Status:** done (#155) · **Depends on:** FLOW-312 (#145)
- [x] `undo_batch` undoes a `line_split` (an `assign_expenses` `parts[]` row) or `line_pnl` (`set_lines_pnl`) row through `mcp_undo(kind, transaction_id)`, which picks the newest live write on that line, not the batch's own. A later `split_line` / `set_line_pnl` on the same line is undone instead and the row reads ok. Return the `private.mcp_writes` id from `mcp_split_line` and `mcp_set_line_pnl`, store it in `row_writes`, and make the batch row `conflict` when a newer live write of that kind exists on the line.
- [x] `mcp_undo('line_split')` and `private.line_split_parts` drop `percent` and `is_rest` (added in `20261008140000`), so an undone split comes back without its percent and rest markers.
- [x] An `assign_expenses` `parts[]` row returns no stored parts; consider returning the cents as `split_line` does.
- [ ] From the #155 review: no dblink test for `undo_batch` and `undo` on the same line at once (the lock order), and none for a newer `split_line` on the line by another user or token.

<a id="flow-137"></a>
### FLOW-137 · Prime-linked loan rates (Flow MCP agent request)
- **Type:** SMALL CYCLE · **Status:** claimed (dev lane 2, 2026-10-08, claude/project-thread-pz6l1n) · **Depends on:** —
- **What:** Some demand loans are Israeli prime plus a margin, and each Bank of Israel change meant a `set_loan_rate` call per loan. A loan can carry an index (`il_prime`) and a margin; one `set_index_rate` call writes the dated rate (index plus margin) on every loan linked to that index, with one undo.
- **Acceptance:** pgTAP for the link, the fan-out, a loan that starts after the date, and the undo (including a conflict when a rate changed since); MCP tests; `list_loans` shows the index and margin.
- [x] `loans.rate_index` and `loans.rate_margin_ppm`; MCP `set_loan_index` (undo `loan_index`).
- [x] MCP `set_index_rate` writes a `loan_rates` row per linked loan (undo `index_rate`, all or nothing).
- [x] `list_loans` adds `rate_index` and `rate_margin_ppm`.

<a id="flow-312"></a>
### FLOW-312 · Split-by-category follow-ups (FLOW-311)
- **Type:** BACKLOG NIT · **Status:** done (items 1 and 6 in #133, item 2 in #136, item 5 in #145; items 3 and 4 moved to FLOW-325) · **Depends on:** FLOW-311
- [x] `get_project.transactions` lists only lines filed to or shared with the project, not lines that reach it through a part. (#133)
- [x] A bank re-sync that changes a split line's amount makes it count whole silently; open a review item (like the loan split `needs_review` flag) instead. (#136: an open `split_mismatch` review, decision [0125](../decisions/0125-split-line-resync-review.md). The review card says "הפיצול לא תואם את סכום השורה בבנק." with "עדכון הפיצול", which opens the parts editor (FLOW-325 app PR).)
- [x] After FLOW-104: let a part take the other kind as a reversal, like a whole line. Moved to [FLOW-325](#flow-325).
- [x] App screen to view and edit the parts (SMALL UI, plan with a mockup first). Moved to [FLOW-325](#flow-325).
- [x] `split_line` inside the `assign_expenses` batch, with `undo_batch`. (#145: an `assign_expenses` row with `parts[]`)
- [x] `get_home.other_currencies[].count` (`count(*)`) and `get_project.other_currencies[].count` (one per row) count each part of a split line, and each loan split part, as a line. Count `distinct transaction_id`, as `company_pnl` does. (#133)

<a id="flow-301"></a>
### FLOW-301 · Income and expense drill-down from Home
- **Type:** PLAN FIRST · **Status:** plan-first, planning claimed (UI task 4 thread, 2026-10-07, claude/project-thread-uf00mt) · **Depends on:** —
- **What:** Tapping נכנס (income) or יצא (expenses) on Home opens every line of that kind for the selected period across all projects, grouped and totaled by category, project or payer, each line tappable to its detail. Same period selector as Home, amounts shown like the rest of the app, kept-out categories respected. MCP: a tool and RPC returning the aggregated lines (direction, period, group_by).
- **Plan:** [flow-301-drill-down.md](../review/flow-301-drill-down.md). Owner approved option A (group totals, then a group's lines) on 2026-10-07. Server PR first (RPCs + MCP `get_breakdown`), then the screens.
- **Acceptance:** mockup approved; totals match Home for the same period; MCP test.

<a id="flow-302"></a>
### FLOW-302 · Month dividers in every transaction list
- **Type:** SMALL UI · **Status:** done (#98) · **Depends on:** —
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/AHkHqk9WgUeCXb9wHYwdVB) (compact sticky header, month name, +income −expenses per currency), under the owner's standing rule for UI tasks.
- **What:** One list, no new page: a sticky month header (for example "יולי 2026") between months, with that month's income and expenses (expenses with a minus, `$` for USD). Built once in the shared list component so every list gets it (project lists, recent transactions, review lists).
- **Acceptance:** mockup approved; subtotals match the rows; RTL and 320px checks; design review.

<a id="flow-313"></a>
### FLOW-313 · Month dividers follow-ups (#98 review)
- **Type:** BACKLOG NIT · **Status:** done (#242) · **Depends on:** FLOW-302 (#98)
- [x] The month totals add rows by direction: a shared line counts at its full amount and a refund counts as income, so a month header is not that project's P&L for the month. Owner to decide whether that's fine or the header should follow the P&L rules (Decisions needed). (Owner 2026-10-08: keep cash in and out, so the header adds up the rows it sits over.)
- [x] Switching between the flat and the grouped list (a held order splitting a month, or a second month loading) remounts the rows, so a focused row loses focus. (The flat list is a headless section keyed by its first month, so its rows stay mounted when a month is added or removed; rows that move to another month's section still remount.)
- [x] Screen readers hear the figures with no separator ("הוצאות −₪2,200הכנסות +$1,500"); add a pause between figures and lines. (A hidden ", " before each figure but the first.)
- [x] A month with large ILS and USD figures makes a three-line pinned bar (about 85px) at 320 to 390px; consider one currency per line only when needed. (Currency lines now share a row while they fit and wrap only when needed; story `TwoCurrenciesOneRow` is 42px, was 61px. Nine-digit figures in two currencies still need the rows.)
- [x] `MonthList` takes a `className` no caller passes; drop it or use it. (Dropped.)

<a id="flow-303"></a>
### FLOW-303 · Previous and next on the transaction card
- **Type:** SMALL UI · **Status:** done (#100) · **Depends on:** —
- **Approval:** 2026-10-07, the design reviewer's option A (˄ ˅ in the card's top bar, ArrowLeft/ArrowRight, replace on move), built under the owner's standing rule for UI tasks. Swipe moved to [FLOW-314](#flow-314).
- **What:** Swipe (RTL-aware) or tap small arrows in the header to move to the previous or next transaction, in the same list and order the card was opened from (project list, review queue, recent, filtered). Keep the list position on return; prefetch neighbours.
- **Acceptance:** mockup approved; Back returns to the same scroll spot; keyboard and screen-reader access; design review.

<a id="flow-314"></a>
### FLOW-314 · Swipe between transactions on the card
- **Type:** SMALL UI · **Status:** ready · **Depends on:** FLOW-303 (#100)
- **What:** Follow-up from FLOW-303. A sideways swipe on the card does what ˄ ˅ do: the finger moving right opens the next card (it enters from the left, like a screen push), left opens the previous one. Touch only; ignore a start within 24px of a screen edge, inside a sheet or a field, or while a sheet is open; decide after 10px and hand mostly vertical moves to the page scroll; the card follows the finger and commits past 30% of the width or a flick; no movement at a list end; reduced motion swaps on release.
- **Acceptance:** a touch probe on a phone, not only the clip check; CONTROLS row; design review.
- Also from #100's design session: add the project's waiting list (card rows only) and let ˅ at the last loaded category row load the next page. From #100's code review: the Home breakdown lines (FLOW-301) open a card with no list; pass the list there too.

<a id="flow-304"></a>
### FLOW-304 · Record metadata and richer transaction detail
- **Type:** PLAN FIRST · **Status:** done (#107) · **Depends on:** —
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/4Wsob4i3XEuLcMgX4SRj3M) (one meta line on the review card, a static "פרטי הבנק" section on the detail), under the owner's standing rule for UI tasks. Decision [0113](../decisions/0113-bank-details-per-line.md).
- **What:** Show the bank or provider metadata per line on the review card and the detail: payment method (card and last 4, ACH, wire, check), memo, counterparty, bank account, original bank description. Icon-based (a card icon and ••1234, a memo on tap). Source: `transactions.provider_meta`. Also a better detail screen for what isn't shown at first glance. MCP: `get_expense`, `list_review` and `search_expenses` return the normalized fields.
- **Acceptance:** mockup approved; no account numbers beyond the last 4 anywhere.

<a id="flow-315"></a>
### FLOW-315 · Bank details follow-ups (#107 review)
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-304 (#107)
- [ ] The first review card grows 19 to 38px when its bank details arrive, so אישור moves. Read the whole queue's details in one `get_line_meta` call with the list.
- [ ] The detail memo row that clamps past 4 lines has no visible expand cue (the card memo has ▾).
- [x] `private.mask_long_digits` misses digit runs split by spaces or dashes; only matters if a writer other than Mercury's redactor stores a memo.
- [x] `get_line_meta` uses `current_company_id`, so demo viewers get an empty list (same as `get_transaction`); re-check `card_last4` as 4 digits on read. (`20261010100000_viewer_reads.sql` also moves list_review, list_skipped_review, list_categories, list_project_category, project_waiting and search_transactions back to the readable company; a pgTAP guard fails when a later redefinition drops it. `get_project` still filtered on `owner_id`, so a viewer's project page was empty: fixed in `20261010190000_viewer_project_page.sql` with the drill-down, category totals and filed-today helpers.)
- [ ] Stored Mercury account labels lose their digits at import, so the account row never shows a last 4. Keep the label's last 4 at import if the owner wants it.
- [ ] The review queue warms the first other row's details, not the next card's.

<a id="flow-305"></a>
### FLOW-305 · Review list in a bank-statement style
- **Type:** PLAN FIRST · **Status:** done (#111) · **Depends on:** —
- **What:** Rows grouped by day headers (today, yesterday, date), a round initials avatar, the counterparty in bold with the payment method under it, the amount at the end with small cents, income in green, a pending chip, dense rows without card borders.
- **Acceptance:** mockup approved; design review.

<a id="flow-306"></a>
### FLOW-306 · Invoice photo capture
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** From the original plan: photograph or pick an expense invoice, compress on the phone, upload to private storage, extract supplier, amount, VAT, date and invoice number, check for a duplicate, and match a bank line. Needs a model and cost decision.
- **Acceptance:** plan approved; field accuracy measured on invented sample invoices.

<a id="flow-307"></a>
### FLOW-307 · Large amounts on the transaction detail at 320px
- **Type:** SMALL UI · **Status:** done (#111; design reviewer's option A, stepped fit for display amounts) · **Depends on:** —
- **What:** The detail amount (36px display) doesn't step down, so a 10-digit amount with cents starts past the side padding at 320px (also on main). Reuse the hero step-down logic.
- **Acceptance:** clip-check story at 320 with the largest amount; design review.

<a id="flow-308"></a>
### FLOW-308 · Return to the intended route after sign-in
- **Type:** SMALL UI · **Status:** done (#111; design reviewer's option C, built under the owner's standing UI rule) · **Depends on:** —
- **What:** Sign-in always lands on Home, so a deep link (for example the evening review nudge to `/review`) is lost. Return to the requested route after sign-in, through a strict allowlist like the existing `?return=` handling.
- **Acceptance:** e2e for a signed-out deep link to `/review`; an off-list route still goes Home.

<a id="flow-309"></a>
### FLOW-309 · Review queue follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Unit-test the live refresh of filed-today and the transaction on approve and undo; restore the toast fade-ramp assertion.
- [ ] Decide whether the queue banner counts every filed-today row (it should match the list); align the preview's filed-today list with live.
- [ ] Fixtures for a single-project item with `project_suggested` false; a real soft-keyboard test.
- [ ] Counter shifts sideways at 9→10 and 99→100 (tabular digits, reserve width).
- [ ] Focus falls to body after a successful אישור or ביטול; move it to the next card's אישור.
- [ ] Banner and card spacing: keep the 8px step and trim only on short screens; at 320×693 a wrapping supplier plus a reason line pushes שינוי/דלג under the tab bar; a one-line banner saves 44px.
- [ ] e2e for the plural title at 320 and for אישור clearing the tab bar at 320×693.
- [ ] A card returning mid-swap sticks with אישור disabled; same-card changes outside the key aren't shown; a ref is written during render.
- [ ] Tests: the project-picker toast pad path; click through from 'בחירת קטגוריה' to the picker; assert `open.search` is empty; a test that fails if the effect deps revert.
- [x] A posted pending-income line leaves an open row with a null reason; a row marked changed still gets re-queued. (Server part, #158: the row takes the income reason or leaves review; `changed` counts as settled.)
- [ ] Income always reports `missing_project` even when the category is missing too. (The guessed income category fills the line, so `category_suggested` carries the guess; pick the reason label for a guessed category with no project. When income can show `missing_category`, `set_transaction_category` with the default `p_resolve` resolves it as changed while the project is still empty; queue `missing_project` then.)
- [ ] A connector invoice and its receipt both land in review. (Needs a design for pairing them.)
- [x] Prod QA: after a project pick a refetch could reorder the queue and put another line under אישור; skip also used the queue head, not the card on screen. (The card on screen is pinned by its line until handled, `review-pin.ts`.)
- [x] Filed-today banner counted the owner's own picks as automatic. (Automatic only, Eliran 2026-10-08.)
- [x] Skipped cards had no list and no undo. (Skip toast ביטול; server read `list_skipped_review`; reopen of a skipped card keeps later edits.)
- [x] App: a דולגו section under הצג הכול that lists `list_skipped_review` with החזרה לתור (`reopen_review`). Mercury UI thread. Also drop the reviewer preview's approved split from its filed-today sample (`fileReviewerApproval`). (FLOW-327 PR #175; the empty queue links to it with "{N} פריטים דולגו", owner 2026-10-08.)

<a id="flow-310"></a>
### FLOW-310 · Sheets, focus, keyboard and shared controls
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Sheet history: ✕ tapped the instant a sheet mounts leaves a dead Back step; under heavy slowdown Escape on a stacked confirm can leave a stale entry; a reload with a sheet open leaves a dead entry; the status sheet isn't restored after a hard reload.
- [ ] Stacked sheets: the sheet underneath snaps from dimmed to full in one frame when the top one closes.
- [ ] After Escape on a ניתוק confirm, focus lands on ניתוק with no visible ring; ✕ and Escape on Settings sheets don't return focus to the opening row.
- [ ] Decide whether Back should be blocked on the shown-once code step like a backdrop tap ([0082](../decisions/0082-settings-redesign.md) §8); confirm a quick double tap on the help backdrop can't close the code sheet.
- [ ] Keyboard: a fallback when the layout viewport shrinks too (browsers that ignore `interactive-widget`); Vaul's keyboard state flips on multi-step viewport resizes; reduce `--sheet-gap` while the keyboard is open at 320. Real-device QA on iPhone Safari and PWA, Android Chrome and Samsung.
- [ ] Money field: the gap between the `₪`/`$` prefix and the digits grows with the number's length.
- [ ] `ListRow` nests a `div` inside `button` and `a`; limit the heading markup to the static row.
- [ ] Toast: a tall-sheet fallback that respects the safe area; the toast may cover an open sheet's ✕ for a moment.
- [ ] Ellipsis truncation on chip, pill, segment and switch labels and sheet titles is whitelisted in the clip check; review it.

<a id="flow-319"></a>
### FLOW-319 · Type sizes, headers and text colours, income in green
- **Type:** SMALL UI · **Status:** done (#111) · **Depends on:** —
- **What:** The owner's ask (2026-10-07), with a bank app's transaction list as the reference: clean up type sizes and header sizes, review text colours and sizes across screens, and show income amounts in green. Done at the token and shared-component level (type scale, page titles, section and month headers, row title and secondary line, list amounts), so one PR moves every screen. Income green replaces the "green only with ▲" rule for amounts, through a new decision. Row layout changes (avatars, bank-statement rows) stay in FLOW-305.
- **Acceptance:** the design reviewer's recommended option built; WCAG AA for the income colour in light and dark; decision record; clip-check at 320; design review.

<a id="flow-320"></a>
### FLOW-320 · Open the picker that was tapped on the transaction detail
- **Type:** SMALL UI · **Status:** done (#125) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. On the transaction detail, the project row opens the change sheet straight on the project picker and the category row on the category picker, instead of the summary sheet. The review card's שינוי keeps the summary. A split row keeps opening the split.
- **MCP:** none new; `assign_expense` and `set_expense_category` cover the write.
- **Acceptance:** re-filing a project or category from the detail is 2 taps; Back from the picker returns to the detail with no dead history step; focus returns to the tapped row; tests for both rows; design review.

<a id="flow-321"></a>
### FLOW-321 · Two rows in Home's attention card (review and unpaid)
- **Type:** SMALL UI · **Status:** done (#130) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. Unpaid invoices can't be reached while the review queue has items: the Home card links only to Review. When both exist, the card shows two rows, one to Review and one to Unpaid with its total; one row when only one exists. Singular copy for a count of 1.
- **MCP:** none.
- **Acceptance:** unpaid is 1 tap from Home with items waiting; tests for 0, 1 and many on each side; each row has its own accessible name; light, dark, 320px; design review.

<a id="flow-322"></a>
### FLOW-322 · Copy and dead-end fixes from the UX review
- **Type:** SMALL UI · **Status:** ready; split: UI lane 2 takes the transaction detail's document-row hint, UI lane 1 the rest. Mark `done` only when both PRs merged · **Depends on:** —
- **What:** From the 2026-10-07 UX review: a period control on the group-lines screen and an empty state that offers choosing a period (today a dead end); singular copy for one waiting item on the breakdown; the detail's document-row hint names only what the row shows; the Review subtitle covers bank lines too; category rows in Settings open that category's lines; the `/notifications` route that nothing links to is removed or linked.
- **MCP:** none.
- **Acceptance:** each string in a test; no empty state is a dead end; a category row opens its lines; design review.
- [x] (UI lane 3, 2026-10-09) The group-lines screen takes the period pill and its empty state offers "בחירת תקופה"; one waiting line on the breakdown reads "תנועה אחת ממתינה לאישור"; the review queue subtitle is "תנועות שמחכות לשיוך"; a category row in Settings opens that category's lines in search.
- [ ] `/notifications`, which nothing links to: remove it after #245 merges (it changes flow-screens.tsx and the pages and controls e2e specs).
- [ ] The transaction detail's document-row hint (UI lane 2).

<a id="flow-323"></a>
### FLOW-323 · Search and all transactions
- **Type:** PLAN FIRST · **Status:** in progress (PR #TBD), UI lane 1 (server done in #196, owner chose "server now", 2026-10-08; owner approved mockup A, 2026-10-08) · **Depends on:** FLOW-302
- **What:** From the 2026-10-07 tap-count review: finding a line by supplier takes 4 to 6 taps and only inside the selected period. One list of every transaction with a focused search field and filter chips one tap away (income or expenses, project, category, period, waiting for review), reached from a search icon on Home and Projects. Options for the mockup: an entry icon only, or the review tab becomes a transactions tab with review as a filter.
- **MCP:** `search_expenses` and its RPC gain optional date, project, category and direction arguments (read only).
- **Acceptance:** plan and mockup approved; a line is 2 taps away after typing; results match `search_expenses`; tenant isolation test on the RPC. Overlaps FLOW-402, 303 and 305.
- [x] Server and MCP: `search_transactions` and `search_expenses` filter by date, direction, project and category (with `none`), take a `pending` scope, match the customer, and return currency, review, kept-out and split state; tenant isolation test (migration `20261011010000`, decision [0140](../decisions/0140-search-filters.md)). Plan: the project's plans/flow-323-search.md.
- [x] Mockup in the design thread, owner approval on a card (2026-10-08). **Owner picked A:** a search icon on the Home and Projects bars opens the screen; the search field and filter chips sit at the bottom, just above the keyboard, and the results list fills the space above them. The icon is a plain thin-stroke outline magnifier (no emoji, no filled glyph), like a bank app's search. Chevrons are SVG icons so right-to-left text never flips them: Back points right, "more" points left. Rows reuse the review list's statement rows with month dividers, tint the matched text, and say when a line waits for review, is split or is kept out of the P&L; a count line totals what is shown. FLOW-402 is this screen opened from the project page's "כל התנועות" with the project chip set. Mockup: the project's plans/flow-323-search-mockup.html.
- [ ] Screen in a UI lane, reading `search_transactions` (PR #TBD, decision [0146](../decisions/0146-search-screen.md)).

<a id="flow-324"></a>
### FLOW-324 · Approve all suggestions in the review queue
- **Type:** PLAN FIRST · **Status:** dropped · **Owner (2026-10-08):** no approve-all in the app; the owner reviews lines one by one. MCP keeps batch approve through `assign_expenses` as today. · **Depends on:** —
- **What:** The owner's ask (2026-10-08), to be planned first: an "approve all suggestions" button on the review queue, so a queue of lines that already carry a suggested project and category is cleared in one tap instead of one card at a time. The plan settles which lines count (both fields suggested, no split, no unallocated shared cost, no reversal, no loan line), what the button says with its count, a confirm or a toast with ביטול that restores every line, how a partial failure reads, and how it sits beside the list and the card. Overlaps the "approve all sure ones" item in FLOW-701.
- **MCP:** a batch approve over `list_review` items, matching the button's rules, or a documented reason to leave it to `assign_expenses`.
- **Acceptance:** plan and mockup approved; the rules for which lines are approved are written down; undo covers the whole batch; tenant isolation test on any new RPC.

<a id="flow-325"></a>
### FLOW-325 · Split a refund across projects and categories by percent or amount
- **Type:** MCP · **Status:** server done (#135, #142); app screen first PR merged (#150, plan option A); follow-ups and #135 review items open · **Depends on:** FLOW-311, FLOW-104
- **What:** The owner's ask (2026-10-08): select part of a refund (or any line) and split it between projects and categories by percent or fixed amounts, the rest staying where it was. Server: `save_line_split` and MCP `split_line` parts take `amount_minor`, `percent` (rounded together so the parts hit the line to the cent) or `rest: true` (the line's own category and project by default); a part of the other kind is a reversal (a refund back against expenses) and needs a project. Decision [0123](../decisions/0123-line-split-percent-rest-reversal.md). Takes over FLOW-312's reversal-part and app-screen items.
- **App:** a screen on the transaction detail to view and edit the parts, by percent or amount, with the rest shown live. Plan and mockup in the design thread, owner approval on a card before building.
- **Acceptance:** pgTAP for rounding, rest, reversal P&L effect and refusals; MCP tests; mockup approved; the screen's parts match `get_line_split`.
- [x] Parts screen server asks: preview (`p_preview`), `percent` and `rest` on `get_line_split`, named refusals for a repeated pair and a line of zero.
- [x] (#135 review) `get_project.transactions[].parts_minor` sums parts unsigned; with reversal parts it should be signed by kind before the app screen shows it. (Signed against the line's own kind: migration `20261010220000`, decision 0138.)
- [x] (#135 review) A reversal part in a kept-out category still needs a project; 0103 lets a kept-out whole line skip it. (No project needed: migration `20261010220000`.)
- [x] (#135 review) A part with no project and one naming the line's own project are different pairs, so the same category and project can appear twice. (The server now treats no project as the line's project: migration `20261010220000`.)
- [x] App screen, first PR (PR #150): the "פיצול" section on the transaction detail with a read view of the parts, the full-screen editor (parts, % / ₪ with the server preview's cents, the live rest row, the sticky totals), refund reversals that need a project, save on leave with the hold line, clearing with a confirm, undo from the toast, and the detail's category and project rows saying the line is split.
- [ ] App screen follow-ups (plan §10): swipe to delete a part, splitting from the review card, "N חלקים" on the transaction lists.
- [ ] (#189 review, UI lane) The parts editor (`app/src/line-split.ts`) still asks for a project on a kept-out reversal part; allow none, as the server does unless the line is in the P&L (0138). Give copy to the `a reversal part needs a project` refusal from `set_transaction_pnl` on the transaction screen.
- [x] (#189 review, server) MCP undo of `line_split` puts old parts back without the 0138 check, so a kept-out reversal part with no project can come back on a line the owner since put in the P&L. Run the same check after the insert (a shared private helper with `set_transaction_pnl`) and answer `conflict`. (Migration `20261010230000`.)

<a id="flow-326"></a>
### FLOW-326 · Screen titles and row text on the start side
- **Type:** SMALL UI · **Status:** done (#165) · **Depends on:** — · **Source:** mobile UI/UX review cycle 1 (2026-10-08, D1, D2, D5, D16, D18)
- **What:** (1) On every screen with a Back control the title is pushed to the far left, away from its kicker (categories, connections, loans, unpaid, filed, project category, notifications, onboarding). `ScreenHeader`'s `.ui-page-title-row` uses `space-between`; put the title on the start side, Back on its own row as in mockups 07 and 14 (the existing `layout="stacked"` option may already do this). (2) `ListRow` rows rendered as `<button>` centre their label and hint (transaction detail project/category labels, connections status, add sheet rows): add `text-align: start` to `.ui-row`. (3) The settings switch row has no icon slot and a 600 title; give `Toggle` the row icon slot and the 400 row-title weight everywhere. (4) Help's Back is plain text; use the shared Back.
- **Acceptance:** shared components only (`screen-header.tsx`, `list-row.tsx`, `toggle.tsx`, `ui.css`); stories updated; clip-check at 320/360/390, light and dark; design review.

<a id="flow-327"></a>
### FLOW-327 · Review card: actions in the thumb zone, tidy spacing
- **Type:** SMALL UI · **Status:** done (#175) · **Depends on:** — · **Overlaps:** FLOW-309, FLOW-315 · **Source:** cycle 1 (U3, U6, D3, D9, D12)
- **What:** Approving one card at a time is the most repeated job, and אישור moves between y=449 and y=584 depending on the card, with about 250px empty below; on a 375x667 phone with the banner, שינוי and דלג sit under the tab bar. Pin אישור / שינוי / דלג in a bar just above the tab bar; the card scrolls above it. Also: a gap of `--space-3`–`--space-4` between the auto-filed banner and the card (they touch today); label and value columns aligned on the card with tighter rows (mockup 03); the counter reads "1 מתוך 3" without padding spaces; a disabled אישור says why ("בחרו פרויקט וקטגוריה").
- [x] (cycle 2, deploy 9ea1e9a) The "✦ הצעת Jev" pill trails each value, so on a card where Jev filled both fields the two pills start at different points; with values in an aligned column (above) the pills line up too.
- [x] (cycle 2) At 320 the pill takes about 90px and long project or category names are cut to a few words ("וילה רעננה – …"). Let the name keep priority: wrap the pill under the value, or shorten it to "✦" with the full label as its accessible name.
- [x] (cycle 3, deploy a77efd8) The skip-undo toast sits at the top (y≈102–149) and covers the counter; show it just above the action bar, near the thumb (owner chose this 2026-10-08; supersedes the toast position in decision 0069, so the build adds a decision record). The DevReview fixture also lacks the ביטול action, so add it there for screenshots.
- [x] (cycle 4, deploy 6b3a05e, high) Regression from #165: a review queue with Back (filtered to a project, opened from הצג הכול, the sample reviewer queue) now gets the stacked header, so the card and buttons drop 50–76px; with the banner and a shared-cost card at 375x667, שינוי (y≈582–661) and דלג sit on the tab bar. Give those headers `layout="inline"` (`flow-screens.tsx` ReviewQueue ~1656, ~1866, `setup/sample-review.tsx:55`); the counter says where you are. Add "filtered queue + banner + shared cost at 375x667" to this task's stories. Done in #175 r1: `layout="inline"` on every review header with Back; story `ReviewFilteredBarSharedBanner375`.
- [x] (cycle 4) "הצג הכול" is a 58x44 link in the top-left corner, the farthest point from a right thumb; on a card opened from the list it and Back both go to `/review/all`. Hide it when `from=all`, and put it on the start side of the counter row (or in the pinned bar as a secondary action). Done in #175 r1: on the start side of the counter row, hidden on a card opened from the list.
- **Acceptance:** אישור at the same position on every card state at 375, 393, 412; nothing under the tab bar at 375x667; stories for plain, banner, shared-cost, disabled and Jev-filled cards; design review.

<a id="flow-328"></a>
### FLOW-328 · Mobile UI consistency pass (cycle 1)
- **Type:** SMALL UI · **Status:** done (#165; whole-unit amounts item open, conflicts with 0120) · **Depends on:** FLOW-326 · **Source:** cycle 1 (D4, D6, D7, D8, D10, D11, D13, D14, D15, D17, U10, U11, U13)
- [x] Change sheet rule preview: the arrow's space is inside the LTR bdi, so it renders on the wrong side ("ספק ␣␣←פרויקט"); spaces outside the bdi.
- [x] Split screen: remove the hairlines between choices, 24px side gutter like other screens, amount on the start side.
- [x] Install screen: remove step hairlines and centre the number circles on their text.
- [x] Change sheet: values at the same weight as the transaction detail; title-to-subtitle gap as mockup 06.
- [x] Project screen: more space between the band and the overhead switch (mockup 02).
- [x] Empty and error states use the standard button, not a 36px pill, and match each other.
- [x] The "מצב תצוגה" tag on the band sits on the start side, clear of the curve.
- [x] No minus sign on a figure already labelled expenses (project band, category rows).
- [x] Status chip "שולם" carries the ✓ like mockup 10.
- [x] Notifications uses the shared EmptyState, Hebrew only.
- [ ] Amounts in lists in whole units; agorot only when non-zero, on detail and edit fields (§3.5). (Not in this PR: transaction rows show cents, ".00" included, by the owner's decision [0120](../decisions/0120-income-green-type-scale.md) option C; needs an owner call before it changes.)
- [x] Transaction list rows carry the trailing chevron, then drop the "אפשר לפתוח כל תנועה" explainer.
- [x] Empty Home names bank or SUMIT ("חיבור בנק או SUMIT"), opening the connections page.
- [x] (cycle 3) One word for splitting a line: the detail section says "פיצול" while older screens say "חלוקה". The owner chose "פיצול" (2026-10-08); use it on every screen and in the MCP copy.
- **Acceptance:** shared components and stories; clip-check; design review.

<a id="flow-329"></a>
### FLOW-329 · Out of the P&L as a visible row on the transaction
- **Type:** SMALL UI · **Status:** done (#248) · **Depends on:** — · **Overlaps:** FLOW-124 · **Source:** cycle 1 (U5, D15)
- **What:** On the transaction detail, the only way to take a line out of the P&L is an unlabelled ⋯ at the top-left corner, the hardest spot to reach one-handed. Show a "ברווח והפסד" switch row under the category row; keep ⋯ only for delete. Move "פיצול בין פרויקטים" to the bottom of the screen, in the thumb zone. (cycle 3) The new "פיצול" section from #150 also sits mid-screen; it moves with it.
- **Acceptance:** out-of-P&L is one tap on the detail and reversible; ⋯ shows only when delete applies; tests; design review.
- **Done (#248):** a "ברווח והפסד" switch row under the category row (a loan line shows it locked); ⋯ only on a manual line, holding מחיקה. The פיצול section was already at the bottom of the card.
- [ ] Follow-up from #252: a line in a loan category with no loan split (`pnl_fixed`, unmatched) still shows the locked row as "תשלום הלוואה · נספר לפי הפיצול", though nothing is split. Give it its own hint (#252 changed only the matched case, to "לפי חלקי ההלוואה").

<a id="flow-330"></a>
### FLOW-330 · Mark paid that stays marked
- **Type:** SMALL CYCLE · **Status:** done (#199; server and MCP #163) · **Owner (2026-10-08):** option (a), store it · **Depends on:** — · **Source:** cycle 1 (U4)
- **What:** On Unpaid, "סימון כשולם" takes 2 taps (the button, then הבנתי) and then only hides the row in screen state (`unpaid-screen.tsx` `setHidden`): the unpaid total never drops (it sums every row), and after a reload the row is back. Options: (a) store a "marked paid, waiting for SUMIT" flag on the server; the row leaves the total and shows "סומן כשולם · ממתין לסנכרון" until the next sync; (b) keep it as a reminder and rename the button to say so, showing the explainer once.
- **MCP:** for (a), the unpaid tools return and can set the flag.
- **Acceptance:** a marked row stays marked after reload; total matches the list; tenant isolation test on any new RPC.
- [x] Server and MCP (#163, decision [0133](../decisions/0133-invoice-paid-marks.md)): `set_invoice_paid(id, paid)` stores the mark, `list_unpaid` keeps the row with `marked_paid_at`; MCP `list_unpaid` and `set_invoice_paid` (undo `invoice_paid`).
- [ ] Screen (UI lane): "סימון כשולם" calls `set_invoice_paid` in one tap (no explainer step) instead of `setHidden`; a marked row shows "סומן כשולם · ממתין לסנכרון" with a way to clear it; Unpaid's total and Home's unpaid row sum only rows with `marked_paid_at` null; add `marked_paid_at` and `currency` to `unpaidRowSchema`.

<a id="flow-331"></a>
### FLOW-331 · A useful + tab while capture is not built
- **Type:** SMALL UI · **Status:** claimed (UI lane 4) · **Owner (2026-10-08):** quick actions (new project, new loan, connect a bank) · **Depends on:** — · **Overlaps:** FLOW-306 · **Source:** cycle 1 (U1, U7)
- **What:** The + in the middle of the tab bar is the best thumb spot in the app, and today it opens a sheet where both options are disabled. Until photo capture (FLOW-306) ships, + offers what works today: new project, new loan, connect a bank. "פרויקט חדש" then leaves the Projects header's top-left corner.
- **Acceptance:** no disabled-only sheet; design review.

<a id="flow-332"></a>
### FLOW-332 · Swipe back from the edge on pushed screens
- **Type:** SMALL UI · **Status:** merged (#238, UI lane 3) · **Owner (2026-10-08):** approved · **Depends on:** — · **Overlaps:** FLOW-314 (gesture rules) · **Source:** cycle 1 (U2)
- **What:** In the installed iOS app there is no system back gesture, so the only way back from a pushed screen is the chevron at the top corner (y≈12–43). Add a swipe from the start (right) edge on pushed screens, with the same gesture rules as FLOW-314, so it never fights horizontal scrolling or the transaction swipe.
- **Acceptance:** works on every pushed screen; doesn't trigger inside sheets or horizontal lists; e2e test with touch.

<a id="flow-333"></a>
### FLOW-333 · Split editor and split review card follow-ups (cycle 3)
- **Type:** SMALL UI · **Status:** ready (C13 open; C1–C9 done in #261 and UI lane 2's C2, C6, C8) · **Owner (2026-10-08):** C2 "עדכון הפיצול" as the main button; C3b and C3c approved as proposed; C4 "הוספת חלק" in the bottom bar · **Depends on:** FLOW-325 (#150, #161); C2 and C8 after FLOW-327 (pinned action bar, same `review-card.tsx`) · **Overlaps:** FLOW-327, FLOW-325 (splitting from the review card) · **Source:** mobile UI/UX review cycle 3 (2026-10-08, deploy a77efd8)
- **What:** Findings on the split-by-category editor and the split_mismatch review card, shot at 375x667, 393x852 (light and dark) and 412x915.
- [x] C1 (high) The ₪ field in a part is a fixed `6rem` (`ui.css` `.ui-lsplit-entry > .ui-field:last-child`), so "₪ 12,345.67" is cut off, and the percent hint shows "25720.16%" with no separators. Put the entry on its own full-width line with `flex: 1` (or size it by `--money-digits`), format the hint; add a 320 story with 9,999,999.99.
- [x] C2 (high, owner chose this) On a split_mismatch card the primary button is still אישור, which keeps the wrong P&L; "עדכון הפיצול" is only a text link. Build: "עדכון הפיצול" becomes the primary in the action bar, אישור becomes a secondary "להשאיר כך"; remove the link from `ReviewCard`.
- [x] C3a After a part's project or category picker closes, focus that part's value field (today 4 taps per amount part, 5 per percent part, 6 per refund part, against the plan's 3).
- [x] C3b (owner approved) The ₪/% unit of a new part follows the unit of the last part typed.
- [x] C3c (owner approved) On an inflow (refund) line, open the reversal section expanded.
- [x] C4 (owner chose the bottom bar) "הוספת חלק" moves down the screen with each part (y=311, 445, 602) and ends under the sticky footer; put it in the sticky bottom bar next to the totals.
- [x] C5 The hold sentence shows live before any ✕ and twice, and the footer grows to about 27% of a 375x667 screen; show it once, only after the first ✕ (`showHold`).
- [x] C6 Disabled controls look active: style `.ui-text-link:disabled`, give the rest row a disabled look, add a "לתור" link to the banner, and line the banner's inset up with the card.
- [x] C7 The ₪/% segment buttons are 34px wide; `min-inline-size: var(--touch-min)` on `.ui-seg-btn`.
- [x] C8 The split_mismatch card shows the whole line's project and category with "הצעה" pills; show one static row "מפוצל · N חלקים" (reuse `lineSplitRowHint`).
- [x] C9 The line's own project appears twice in a part's project picker. (C1, C3a–C3c, C4, C5, C7, C9: #261)
- [ ] C13 (from #231 design review) A Jev card at 375x667 no longer fits above the action bar with the slim banner on: main already misses by about 10px with a reason line, and the filled line ("✦ מולא ע״י Jev" + בטל, one line since #245) adds about 19px; a quiet or loud flag adds more. Add a Screens/Routes story at 375x667 with a Jev card (filled line, a quiet flag, the slim banner on), which needs Jev suggestions and fills in the sample queue, then win back about 20–30px so it fits.
- **Acceptance:** shared components (`ui.css`, `review-card.tsx`, `line-split.tsx`) and stories, including 320 and dark; clip-check at 320/360/390; tap counts back to 3 per part; design review. C10 (word), C11 (section placement) and C12 (undo toast) went to FLOW-328, FLOW-329 and FLOW-327.

<a id="flow-334"></a>
### FLOW-334 · Stacked header follow-ups and phone polish (cycle 4)
- **Type:** SMALL UI · **Status:** ready · **Owner (2026-10-08):** H1 sticky bar, H2 labelled Back, H3 no minus on Home's יצא · **Depends on:** FLOW-326 and FLOW-328 (#165) · **Overlaps:** FLOW-332 (swipe back), FLOW-327 (review queue header items live there) · **Source:** mobile UI/UX review cycle 4 (2026-10-08, deploy 6b3a05e)
- **What:** Follow-ups after the stacked `ScreenHeader` and the consistency pass, shot at 375x667, 393x852 (light and dark) and 412x915.
- [x] (UI lane 3, 2026-10-09, decision 0156: `ScreenHeader` pins a 44px compact bar with Back and the title once a stacked page's title scrolls off; month heads pin under it) H1 (owner chose the sticky bar, 2026-10-08) Long pushed lists lose Back: `header.ui-page` is static, so on שויכו היום (2.8–4.3 screens), the breakdown lines, the category lines and the review list Back scrolls off with no way out but scrolling up. Build: a compact sticky bar (Back + small title, 44px) appears once the large title scrolls off, like iOS large titles. A new header pattern, so the PR adds a design log rule.
- [x] (UI lane 3, 2026-10-09, decision 0156: with Back and a kicker, the kicker is Back's label, cut at 16 characters) H2 (owner chose the labelled Back, 2026-10-08) Back is a lone 44x44 icon at the top start corner (y≈16–60), about 520px above the thumb, and the kicker under it ("הגדרות") repeats where it goes. Build: a labelled Back ("‹ הגדרות", "‹ שיפוץ הרצל 12", cut at about 16 characters) that replaces the kicker; about 3x the target and 22px back on every settings sub-screen. This changes the mockups 07/14 header rule, so the PR adds a decision record and a design log rule.
- [x] H3 (owner chose to drop it, 2026-10-08; with profit by period, PR #199) Home's "יצא −₪4" keeps the minus while the rule drops it on figures labelled expenses (`ui/hero.tsx:127`); mockup 01 has none. Build: no minus on Home's יצא, kept only when refunds beat costs.
- [ ] Split hints still say "מתחלק שווה" (`split-screen.tsx` `evenSentence` and the chosen line); use "מתפצל שווה" and update the tests.
- [ ] Change sheet: 22px between the title and the supplier line against about 10px in mockup 06; the 44px ✕ sets `.ui-sheet-head`'s height (`css/08-tabbar-empty.css`). Give the ✕ a −8px block margin.
- [ ] Split footers (`.ui-split-cta`, `css/12-split.css`) still use a 20px gutter; use `--space-side`.
- [ ] Split choices sit 16px in from the title in light mode, where the card's surface doesn't show; `margin-inline: calc(var(--space-side) - var(--space-4))` on `.ui-split-card`.
- [ ] Onboarding: 10px between the stacked subtitle and "שם העסק", 46px below the field; `margin-top: var(--space-5)` on the onboarding form.
- [x] (UI lane 3, 2026-10-09: Back labelled הגדרות) Notifications has the same Back to Settings but no "הגדרות" kicker (`settings-screen.tsx` `NotificationsScreen`); H2's labelled Back covers it.
- [ ] Project band: 47px from Back to the title against 26px on other stacked headers (`.ui-band-hero` `padding-top`, `css/07-band-home.css`); `--space-2` when the band has a Back bar.
- [ ] Home at 375x667: the first "פרויקטים מובילים" row shows only 22px above the tab bar; tighten the נכנס / יצא rows from a 76px to about a 52px pitch. Cycle 5: since the period bar (#199) no project row shows above the fold at all (the "פרויקטים" head sits at y≈640), so this also needs FLOW-335's band trims.
- [ ] Breakdown: the period chip moved to the top-left corner (Back took the start side), the hardest reach and a different corner than Home; put it under the title on the start side.
- [ ] Project category lines: add the total and count to the subtitle ("שיפוץ הרצל 12 · ₪4 · תנועה אחת").
- [ ] Project detail: the "ממתינה לאישור" row inside "הוצאות לפי קטגוריה" looks like a category; give it the review icon and tint like Home's review row. Move "סיום פרויקט" from the unlabelled ⋯ (its only action) to a row at the bottom.
- [ ] שויכו היום: group rows under project headers with a count and total, keeping only the category in each row's hint.
- [ ] Empty and error actions: Home empty uses the tint button (177x44) and the Review error the filled primary (140x44); both use the tint style per DESIGN-RULES §2.8.
- [ ] Review-cycle fixtures: the breakdown route shows empty Home in preview, `/reviewer/transaction/1` misses its sample row, and the e2e routes have no tab bar; fix so the next cycle can shoot them.
- **Acceptance:** shared components (`screen-header.tsx`, `ui.css`, `hero.tsx`) and stories, 320 and dark included; a design log entry; clip-check at 320/360/390; design review.

<a id="flow-335"></a>
### FLOW-335 · Period bar, by-month page and Unpaid polish (cycle 5)
- **Type:** SMALL UI · **Status:** done (#239) · **Depends on:** FLOW-411 and FLOW-330 (#199) · **Overlaps:** FLOW-334 (Home row pitch, project band gap, labelled Back), FLOW-336 and FLOW-337 (plan-first period items) · **Source:** mobile UI/UX review cycle 5 (2026-10-08, deploy 89b9dc5), shots in the project's reviews/ui-ux-cycle-5/
- **What:** Polish after the period bar, the "לפי חודש" page and one-tap mark paid, shot at 375x667, 393x852 (light and dark) and 412x915.
- [x] (high) Period presets fail contrast: the unselected labels are `on-band-secondary` #F0E8FF on a 16% white track (#905EE8), 3.57:1 against the 4.5:1 that 15px text needs. Use `on-band` #FFF on a track of at most 10% white (4.76:1); `.ui-seg-band` in `ui.css`.
- [x] (high, regression from #199) Unpaid's total jumped to the end side (x≈24–128 at 375): `.ui-unpaid-totals bdi { display:block }` inside `dir=ltr` aligns left. Make `.ui-unpaid-totals` a flex column with `align-items:flex-start` and keep each bdi inline-block (`css/18-period-bar.css`, `UnpaidScreen`).
- [x] Project band at 375x667 is 410px (61% of the screen; mockup 02 is about 313px), and the first line sits at y≈801, 134px under the fold. Drop "פעיל" and the "עד היום" line when the window is the current one, tighten `.ui-band-hero .ui-pbar` margins and the hero padding, and move the overhead switch under the categories. Target: the first line row starts by y≈620 at 375x667.
- [x] The period label is the only way to the period sheet and a custom range, but it reads as plain text. Add a small ▼ (or calendar) icon after it, sized like the band pill's. When the window isn't the current one, the label's hint reads "חזרה להיום" and tapping the selected preset (which already jumps back) gets the same `aria-label`.
- [x] Home's band names the window three or four times (the preset, the label, "רווח נקי ב־3 חודשים" and "מ־1 באוגוסט עד היום"). The explanation line reads only "הכנסות פחות הוצאות" (`heroExplanation`).
- [x] Project band: Back and the "earlier" arrow are the same right-pointing chevron in the same 44px column, about 150px apart. FLOW-334 H2's labelled Back tells them apart; until then give the stepper `--space-2` more inset than Back.
- [x] Project: "לפי חודש" uses the tinted pending-card `Banner` with an empty hint; use a plain `ListRow` with the calendar icon and chevron (`ProjectDetailScreen`, `project-detail-screen.tsx`).
- [x] "לפי חודש": drop the `.ui-months-note` explainer (rows carry chevrons, as FLOW-328 did elsewhere), and keep the hint's "נכנס ₪…" muted: green is for an income amount in the amount slot only (0120).
- [x] "לפי חודש" empty state ("אין חודשים בתקופה הזו") is a dead end: add the tint button "כל התקופה" that sets הכול, and an empty-state story. Superseded by FLOW-337 (decision 0150): the page is the whole project, so the empty state has no wider period; the empty-state story is in.
- [x] Unpaid: "סימון כשולם" sits on the end side under the amount (x 24–180); put it on the start side under the name (`.ui-row-stack { align-items:flex-start }` for this row). The row opens the invoice (its document or the SUMIT link) so the owner can check which invoice it is before marking it. Server part: each `list_unpaid` row has `document_url`, the SUMIT link on `https://pay.sumit.co.il/` or null until a sync reads it (`UnpaidRow.document_url` in `packages/shared`).
- [x] Unpaid after a mark: the row says "ממתין לסנכרון" but the page has no way to sync (5 taps through Settings). When any row is marked, show a "רענון מ־SUMIT" row at the bottom that starts the connector sync, or let pull-to-refresh start it.
- [x] Home and Project: the "מצב תצוגה" tag sits 6px above the band's bottom, inside the 28px corner curve (regression of a FLOW-328 fix); give it `--space-3`.
- [x] Connector status sheets: "ניתוק" is the bottom row right under "רענון עכשיו", where the thumb lands first. Put ניתוק in its own group after a section gap (`connections-screen.tsx`).
- [x] Review-cycle fixtures: add the "לפי חודש" empty state, an Unpaid row already marked, and the connector status and connect sheets so the next cycle can shoot them.
- **Acceptance:** shared components (`period-bar.tsx`, `segmented-control.tsx`, `ui.css`) and stories, 320 and dark included; a design log entry; clip-check at 320/360/390; contrast check on the band; design review.

<a id="flow-336"></a>
### FLOW-336 · Step the period one-handed
- **Type:** PLAN FIRST · **Status:** done (#239, decision 0150) · **Owner (2026-10-08):** add the swipe on the band figure; the arrows stay · **Depends on:** FLOW-411 (#199) · **Overlaps:** FLOW-314 and FLOW-332 (gestures), [0141](../decisions/0141-period-bar.md) · **Source:** mobile UI/UX review cycle 5
- **What:** The period bar sits in the top third on Home (presets y≈15–51, stepper y≈62–111 at 375x667) and on the project band (y≈162–258). Stepping a month from Home's default takes 2 taps at the top edge and each further month another, about 550px above a resting thumb. Proposal: keep the bar where the owner put it, and add a sideways swipe on the band's hero figure that steps the window by the preset's length (same rules as the stepper: the later step stops at the current window), with a short haptic and the label updating. Swipe is the one-handed path; the arrows stay for accessibility.
- **Acceptance:** owner's choice on a card; works in RTL (swipe toward the start side goes earlier); does not fight the edge swipe-back (FLOW-332) or vertical scroll; a decision record.

<a id="flow-337"></a>
### FLOW-337 · A period on the "לפי חודש" page
- **Type:** PLAN FIRST · **Status:** done (#239, decision 0150) · **Owner (2026-10-08):** the page always lists every month since the project started, whatever the band shows · **Depends on:** FLOW-411 (#199) · **Source:** mobile UI/UX review cycle 5
- **What:** "לפי חודש" follows the project's period, so at the default 3 חודשים it lists three months with about 300px empty, and seeing the year takes Back, שנה and לפי חודש again (two of them in the top third). Options: the page opens on the whole project ("מתחילת הפרויקט") whatever the band shows, or it gets a compact preset row of its own (`PeriodBar tone="page"`).
- **Acceptance:** owner's choice on a card; Back returns to the project with its own period unchanged.

## Projects and reports

<a id="flow-401"></a>
### FLOW-401 · Project view by category
- **Type:** PLAN FIRST · **Status:** in-progress (UI lane 3; server and MCP done in #233, [0149](../decisions/0149-project-category-months.md); the owner chose "With groups", 2026-10-08, and approved mockup v5 "clean" at 21:44Z: name and amount only, groups fold in place, an amber up arrow in the month view, "—" for a bill not in yet, a "בד״כ" line on the category page, and קבוצה in the category ⋯ sheet; the project's plans/flow-401-project-categories-light.html) · **Depends on:** —
- **What:** Per project, expenses broken down by category with every line visible under its category (no extra taps or "show more"), category consolidation (for example all utilities under one group), a monthly expected amount per category from earlier months, and an alert when a month looks off (a new or missing recurring expense, or an amount well above usual). The math is plain SQL (median of the last 3–6 months, threshold rules); Jev only phrases. MCP: tools for the breakdown, the expected amounts and the anomaly list.
- **Acceptance:** plan and mockup approved.

<a id="flow-402"></a>
### FLOW-402 · All transactions of a project, at a glance
- **Type:** PLAN FIRST · **Status:** done (#210), with FLOW-323: the project page's "כל התנועות" opens the search screen with the project chip set (owner, mockup A, 2026-10-08) · **Depends on:** FLOW-302
- **What:** Tapping "תנועות אחרונות ›" on a project opens a full page with all the project's transactions, with filters by date and category. Polish the project and company cards so everything is reviewable with fewer taps. MCP: `search_expenses` already covers the data.
- **Acceptance:** mockup approved.

<a id="flow-403"></a>
### FLOW-403 · Project timeline and expected months
- **Type:** PLAN FIRST · **Status:** plan-first, screen only (server parts exist: `get_project` takes any date range, [0129](../decisions/0129-profit-by-month.md) and [0141](../decisions/0141-period-bar.md); `get_expected_months` takes a project, [0131](../decisions/0131-jev-patterns.md); `project_category_months` gives the expected cost per category, [0149](../decisions/0149-project-category-months.md)). A UI lane plans the screen with a mockup · **Depends on:** FLOW-401
- **What:** Transactions by a chosen date range (for example last month), plus expected future months from past data, computed in SQL. Shares the recurring-pattern base with FLOW-701.
- **Acceptance:** plan approved.

<a id="flow-404"></a>
### FLOW-404 · Project as an investment
- **Type:** PLAN FIRST · **Status:** ready for a UI lane (server and MCP done in #201, [0143](../decisions/0143-project-investment.md): rehab is every project cost but loan parts and kept-out categories, with a switch per category; owner approved the mockup as drawn, 2026-10-08) · **Depends on:** FLOW-105
- **What:** Per property or project: purchase price, after-repair value, and from Flow's actual costs, forced equity (ARV − purchase − rehab) and current equity (value − loan balance). MCP tools to set and read purchase price, ARV and value.
- **Acceptance:** UX research, mockup and plan approved by the owner.
- [x] Mockup approved as drawn (2026-10-08; the project's plans/flow-404-investment-mockup.html). The project page gets an "השקעה" card under the categories. Its head says מתחילת הפרויקט, and the screen's period and basis don't change it. It has three rows (מחיר קנייה, שווי אחרי שיפוץ, שווי היום with its date), each opening a bottom sheet with the number pad. Each sheet saves its own figure through `set_project_investment` (the שווי היום sheet also its date, which starts on today), on שמירה or when the sheet closes, and מחיקה clears the figure. Under the rows, הון מאולץ and הון נוכחי sit side by side with their formula. An equity that needs a missing figure names the figure; one that can't be worked out because of another currency says so; it never shows 0. Then come two rows: שיפוץ עד היום opens the rehab list by category, with the left-out categories under it, and יתרת הלוואות lists other-currency loans apart. A viewer sees no chevrons and no הוספה, and the overhead project has no card.
- [x] The category ⋯ sheet gets a "נספרת בשיפוץ" switch showing `in_rehab`, with a one-line hint. A kept-out category's hint says why it is off by default. When the owner changed the default, the hint says so and "החזרה לברירת המחדל" sends null. A viewer sees the switch disabled, with its hint.
- [ ] Screen in a UI lane: a shared `InvestmentCard` in app/src/ui with stories (filled, missing, other currency, viewer, loading, error), the edit sheet, the rehab list and the switch (card and sheets in #223; switch is UI lane 3's).
- [ ] Follow-up (server): `get_project().investment` returns `rehab_by_category` from the same CTE as `rehab_minor`, so the rehab list always adds up to the total. Today the app rebuilds it from the project's cash-basis categories and `list_categories().in_rehab`, and shows only the total when they differ: a loan fees part filed in an ordinary category (0130), suggested and in-review lines, shared lines with no category, and archived categories.
- [ ] Open (UI): a counted category in the rehab list should open its lines. The category screen (`project-category-screen.tsx`) reads the period from the URL but always uses the books basis (invoiced), so `?period=all&basis=cash` would not match the rehab figure. Needs a `basis` query parameter on that screen, or the server list above.

<a id="flow-405"></a>
### FLOW-405 · Category management
- **Type:** PLAN FIRST · **Status:** merged (#217, UI lane 3: the Settings → Categories screen; waits on the deploy check; server and MCP done in #207 and #222, decision [0144](../decisions/0144-category-delete-and-move.md); owner approved the mockup v2, 2026-10-08) · **Depends on:** —
- **What:** A clear place for a new user to set up their own categories. Deleting a category that has lines is allowed: warn with the count, then move its lines to untagged (back to review). A bulk "move all to another category". Replaces [0008](../decisions/0008-flat-categories-hide-or-merge.md)'s "delete only when empty" (new decision).
- **Acceptance:** mockup approved; MCP tools for delete and bulk move with undo.
- [x] Mockup approved (2026-10-08; the project's plans/flow-405-category-mockup.html). The category ⋯ sheet gets two rows, drawn with the FLOW-404 switch. "העברת כל התנועות" shows the line count on the row and a hint that the category stays, and sits above מיזוג (whose hint says the category is hidden) and הסתרה. מחיקה comes last, after a line. A hidden category's sheet shows החזרה לרשימה, the move row and מחיקה.
- [x] Move opens the merge picker titled "העברת N תנועות אל". It lists same-kind categories with their line counts, without the source or a category a loan part can't go to. One tap moves, with no confirm, then a toast naming the count and the target, with ביטול, which moves exactly those lines back.
- [x] Delete uses ConfirmSheet. The item names the line count. The consequence says the lines go back to לאישור, counts the split lines that lose their split (a sentence only when there are some), and says remembered suppliers forget the category. When the category has lines, a new optional link, "להעביר את התנועות לקטגוריה אחרת במקום", opens the move picker. An empty category's confirm has no count and no link, and one line: "הקטגוריה תימחק מהרשימה." The toast says the lines went back to לאישור and carries ביטול, which restores the category, its lines, splits and rules. An undo conflict shows "אי אפשר לבטל: תנועה סווגה מחדש בינתיים", and a delete the server refuses anyway shows the server's sentence.
- [x] While a loan uses the category, מחיקה stays visible but disabled, with the reason. The built-in loan categories keep their locked line and get neither row.
- [x] Screen in a UI lane (#217): the two sheet rows, the picker title and counts, ConfirmSheet's optional alternative link with a story, the toasts and the undo conflict error. A hidden category gets no move row, because `move_category_lines` refuses a hidden source; built-in loan categories are left out of the picker.

<a id="flow-406"></a>
### FLOW-406 · Sub-categories and project groups
- **Type:** PLAN FIRST · **Status:** on-hold (owner: not this cycle) · **Depends on:** FLOW-405
- **What:** One level of sub-categories with a parent rollup; project groups (unit, building, portfolio); industry templates in setup that seed categories.
- **Acceptance:** owner's go, then a plan.

<a id="flow-407"></a>
### FLOW-407 · Export for the accountant
- **Type:** PLAN FIRST · **Status:** on-hold (the owner chose "Not now" on the plan, 2026-10-08; plan: a Hebrew CSV from one export_lines function matching company_pnl, plus MCP export_lines) · **Depends on:** —
- **What:** From the original plan: an Excel/CSV export with Hebrew headers and net plus VAT columns, carrying each line's original currency and rate date. MCP: an export tool.
- **Acceptance:** opens correctly in Excel; numbers match the P&L for the period.

<a id="flow-408"></a>
### FLOW-408 · Currency alignment in project lists
- **Type:** SMALL UI · **Status:** ready · **Depends on:** —
- [ ] In mixed-currency projects, the non-tappable USD category rows sit 32px further out than the tappable ILS rows. Reserve the chevron space so the amount column lines up.
- [ ] Verify on main: project rows accept a currency in `list-row.tsx` but never use it, and some list rows (project detail, filed today, project waiting, project category) may drop the currency. Fix any that still do.

<a id="flow-409"></a>
### FLOW-409 · Overhead weights on the cash basis
- **Type:** BACKLOG NIT · **Status:** done (item 1 in 0129, item 2 in #180) · **Depends on:** —
- [x] The overhead split weights by invoiced income even on the cash form of `get_project`. Done in 0129: it weights by the basis' own income.
- [x] No pgTAP for the ILS filter in `get_home` and `get_project`. (`ils_filter_totals.test.sql`: both bases, a range, shared costs and the overhead weights.)

<a id="flow-410"></a>
### FLOW-410 · Find every project in project search
- **Type:** BUG · **Status:** done (#128) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. Project search doesn't find an active project past the first six or a finished one, so those take 3 taps or more. Search filters all projects, finished included, whenever the query is not empty; every active project shows by default, finished ones stay behind their link.
- **MCP:** none (`list_projects` exists).
- **Acceptance:** tests: a seventh active project and a finished project are found by name; 320px check; design review.

<a id="flow-411"></a>
### FLOW-411 · Project screen: lines on open, honest period label
- **Type:** SMALL UI · **Status:** done (#199, with profit by period, decision 0141) · **Depends on:** FLOW-302
- **What:** From the 2026-10-07 tap-count review. Show a project's recent lines (the month list, capped) under its categories without the extra "תנועות אחרונות" tap; the band says the figure is since the project started; the "כל הקטגוריות" link that jumps to Settings goes. FLOW-402 keeps the full page with filters; FLOW-403 adds a period.
- **MCP:** none (`get_project` returns the lines).
- **Acceptance:** a project's lines are 2 taps from the Projects tab; the band names its period; empty and loading states; design review.

<a id="flow-412"></a>
### FLOW-412 · Category drill-down on the cash basis
- **Type:** BACKLOG NIT · **Status:** in-progress (#163) · **Depends on:** —
- [x] `list_project_category` has no basis, so on cash its `total_agorot` and rows include unpaid supplier invoices that the `get_project` category row leaves out (0118). Add `p_basis` and the `line_unpaid` filter, as `get_project` does. From the #154 review. (#163: `p_basis`, default invoiced; the app passes its basis.)

## Onboarding, Settings and connectors

<a id="flow-501"></a>
### FLOW-501 · Tabs reorg: connectors and loans pages
- **Type:** PLAN FIRST · **Status:** done (#111) · **Depends on:** —
- **What:** Dedicated pages for connectors (SUMIT, Mercury, Jev, עוזר AI) and for loans, so Settings keeps only the account, display and "more" rows. The owner approved option A on 2026-10-07: two rows in Settings (חיבורים, הלוואות) open `/settings/connections` and `/settings/loans`; the tab bar and Home stay as they are; viewers can read loans ([0116](../decisions/0116-settings-connections-and-loans-pages.md)).
- **Acceptance:** owner picks the option; mockup approved; shared `ConnectorRow`, `PlugIcon`, `LoanIcon` and stories; old `/settings?sheet=` links redirect.

<a id="flow-502"></a>
### FLOW-502 · Web push notifications
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** A pre-permission card after a user gesture (iOS needs the app on the Home Screen first), service-worker push, server send from an edge function, per-user opt-in. Start with the evening review nudge, then the Sunday summary. Add it to setup step 5 once it ships. About 2–3 PRs.
- **Acceptance:** mockup approved; push received on Android and an installed iOS app; opt-out works.

<a id="flow-503"></a>
### FLOW-503 · Mercury in the setup flow
- **Type:** SMALL UI · **Status:** ready · **Depends on:** —
- **What:** Setup hid Mercury until its import was live. It is live now: add it as a connector option next to SUMIT, reusing the shared connect sheet.
- **Acceptance:** setup step works with Mercury connected or skipped; CONTROLS row; design review.

<a id="flow-504"></a>
### FLOW-504 · Display currency toggle and USD-base companies
- **Type:** PLAN FIRST · **Status:** server and MCP done ([0147](../decisions/0147-company-currency.md)); the screen part is ready for a UI lane: the currency choice in Settings → company, `useCompanyCurrency` reads `base_currency`, Home shows `net_profit_minor` and its change from the `prev_*_minor` fields, the overhead share uses `overhead_share_minor`, and the loan form default · **Depends on:** —
- **What:** A per-company `₪`/`$` display choice with mixed totals converted at display time ([0087](../decisions/0087-multi-currency.md)), and a decision on companies whose base currency is USD (there is no company currency column today).
- **Acceptance:** owner decision; plan approved.

<a id="flow-505"></a>
### FLOW-505 · Import-range picker for connectors
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** A range picker ("from the start" or a date) for SUMIT and Mercury imports. Narrowing the range keeps older rows and only stops syncing them.
- **Acceptance:** mockup approved.

<a id="flow-506"></a>
### FLOW-506 · Setup flow follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Demos use hand-built copies of the review card and tab bar; extract a shared presentational piece (the demo TabBar also writes the shared add-trigger ref and needs a router).
- [ ] Demo VAT amounts are hard-coded strings; derive them from the formatter.
- [ ] Demo card styling (border, radius, padding, divider; a smaller muted ✦ הצעה heading); phone content sits about 15px too high without the status-bar space; demo CSS reaches into component internals; `data-setup-visible` exists only for tests.
- [ ] One list row puts the minus after the amount; it should come before the currency sign.
- [ ] The setup business step forks the onboarding company form; install rows duplicate the install screen; unify.
- [ ] Setup skip flags live in localStorage and restart on a new device; move them to a server table ([0089](../decisions/0089-setup-runner.md)).
- [ ] Key the resume flag by user id; move render-phase module writes to `useLayoutEffect`; tests for API-key clear and the Settings write block; a hold-writes check on the first step's submit.
- [ ] Spec drift: demo timing, the SUMIT sheet sizes at 320, hiding vs focusing שוב during a replay; step 3 scrolls a little longer than designed.
- [ ] Dead CSS (`.ui-setup-stage`, `.ui-setup-phone`); the banner's tone-bad icon; note inset vs frame.
- [ ] Release check on a real iOS device for the Hebrew Safari labels.

<a id="flow-507"></a>
### FLOW-507 · Viewer mode follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] The viewer's review count is a bare number and the visit meter still shows; show a count with "ממתינים" and no meter.
- [ ] The viewer's static SUMIT row uses warning tone for an expired key; use the muted "לא מחובר כרגע" like the AI row.
- [ ] Viewer category rows shrink from 73px to 53px; keep the owner's height.
- [ ] The disabled-on switch track is almost the enabled-off colour; use a muted violet.
- [ ] The viewer note also sits under the project overhead switch; owner to confirm or drop.
- [ ] Inner write gates are untested behind the outer gate (deep-link sheets, SUMIT connect/refresh/disconnect, the add button, category menus, form submits, Jev save, overhead toggle).
- [x] After a failed read the role cache is looked up by user only, not company; the viewer can read the demo audit log. (The user-only key stays, documented in `use-is-viewer.tsx`: a user reads one company and the server refuses viewer writes. The audit log is owner-only in `20261010100000_viewer_reads.sql`.)

<a id="flow-508"></a>
### FLOW-508 · Settings and connect sheet follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [x] Token and key fields render RTL; add `dir="ltr"` (Mercury and SUMIT). (Already in both sheets.)
- [x] An empty token goes to the server and comes back as a toast; add an inline client check with a reserved message line (both connectors). ("חסר מפתח.", "חסר מספר חברה."; focus moves to the first empty field.)
- [x] The busy refresh row shows no spinner; keep the token field read-only while connect is busy. (The row already has `busy`; the key fields are read-only while connecting.)
- [x] A reloaded tab gets no message when a run fails; show the stored last error in the sheet. (Already: the status sheet shows the stored `last_error`.)
- [x] Refresh completion is announced only by the toast; add a status text update. (The sheet's "מחובר · עודכן …" line updates from `last_sync_at` after the refetch; the toast is `role="status"`.)
- [ ] Share one Settings block for Mercury and SUMIT; the Mercury status schema duplicates the DB type.
- [x] Back off status polling on error (3s doubling to a minute, `syncPollInterval`); a run releases only its own claim (mercury-sync, sumit-sync).
- [ ] Consider a shorter claim expiry (15 minutes in the edge functions, `sumit_status` and `claim_connector_refreshes`).
- [x] Settings copy: the "עודכן" phrase should stay on one line at 320; the rate-limit copy without a retry time; the last-use date format; a dangling separator at 320. (The sync time now has its own line in the SUMIT and Mercury sheets, so no line starts with "·"; checked at 320. The retry time shows under רענון עכשיו while held; the last use and the sync time share the today / yesterday / D.M rules.)
- [x] Onboarding header back control goes to sign-in and drops `preview=1`; the onboarding round trip leaves no-op Back steps. (Back goes to `return` with preview kept, and a save replaces the entry. Also: Mercury's "פרטי העסק" link came back to the SUMIT sheet; it now returns to Mercury's.)

<a id="flow-509"></a>
### FLOW-509 · Mercury connector hardening
- **Type:** BACKLOG NIT · **Status:** done (#91) · **Depends on:** —
- [x] After a 429 the sync keeps calling; back off and stop. (#91: a 429 on a recheck stops the rechecks and holds the next run until Retry-After, else 15 minutes.)
- [ ] Skip records aren't written atomically with the lines and duplicate on partial runs; writes after the import aren't atomic with it; the checked-at stamp is still one write per row (#91 made it one read for all rows; full atomicity needs an RPC).
- [x] Reconnecting keeps the old cursor when the token or account changes. (#91: a reconnect to a different set of accounts clears the cursor; a new token for the same accounts keeps it, since the cursor is still valid.)
- [ ] Non-USD Mercury lines are skipped instead of imported in their own currency.
- [ ] The whole treasury history is re-read every sync; the stored-treasury read throws past 20k rows.
- [ ] The cron URL is built by replacing a path in the shared sync URL secret; read its own value.
- [ ] Treasury void matching: exact account first, null fallback only with one treasury account; typed `createClient<Database>` in both sync functions; regression tests for the wildcard; `maybeSingle()` errors on a duplicate external id (moot: `transactions_external_uidx` is unique, and #91 removed that read); test stored-line selects against the local DB.
- [ ] Show "N new lines" after a manual refresh (the counts are returned now).
- [x] Tests: a line dated exactly on `import_from`; an empty treasury list; a non-own treasury counterparty imports; 401/403/404 from treasury refuse validation. (#91 added the `import_from` test; the other three already existed.)
- [ ] Six surviving mutations in the client resume and own-account paths.
- [ ] Runbook: rolling back `mercury-sync` alone after the 0097 migration flips income back and reopens skips; a failed migration push leaves the gap open until a re-deploy.
- [ ] Relabeling gives uncategorized Mercury income the default category suggestion; the changelog should say closing reopened review lines is part of 0097.
- [ ] The token's read-only scope can't be checked at connect (we rely on the path-allowlisted client); document it.

<a id="flow-511"></a>
### FLOW-511 · Easy opt-out from the Home setup card
- **Type:** PLAN FIRST · **Status:** done (#95) · **Depends on:** —
- **What:** A UX review of the setup flow and its Home card ("הגדרה • 4 מתוך 5"). The owner finds it sticky: the only way out is the small quiet הסתרה link, and it's not clear that it stops the card for good. Review the whole flow (setup runner, Home card, the "ההגדרה זמינה בהגדרות." toast, re-entry from Settings, skip flags per [0089](../decisions/0089-setup-runner.md)) and propose one clear button that opts out of setup in a single tap, with the way back from Settings. Mock up the options with Claude Design for the owner.
- **Acceptance:** written plan and mockup; owner picks an option and the approval is written here before any build; then one SMALL UI PR with design review and a CONTROLS row.
- **Approval:** 2026-10-07, under the owner's standing rule for UI tasks, given in the project chat on 2026-10-07 at 16:15 UTC: the next UI tasks run a design session with the design reviewer and build the reviewer's recommended option without waiting for the owner. Option A: a ✕ in the card head that also stops the auto-resume. Decision [0111](../decisions/0111-setup-card-close.md).

<a id="flow-510"></a>
### FLOW-510 · SUMIT sync follow-ups
- **Type:** BACKLOG NIT · **Status:** ready (item 1 done, #156) · **Depends on:** —
- [x] The cron path doesn't take the connector claim, so cron and manual runs can overlap; the Mercury cron path doesn't release its claim when it skips. (Both cron paths claim; a skip or a throw releases it, `_shared/cron_claim.ts`; a SUMIT request that finds a manual run busy goes back to the queue.)
- [ ] From the original plan: a schema-drift check on the SUMIT payload with a fallback and alert, and an optional debounced webhook behind a flag.

## Multi-company and team

<a id="flow-601"></a>
### FLOW-601 · Team members and several companies per user
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** Add members to a company as Viewer (read-only, reuses viewer mode) or Editor; the owner can change a member's role. A user can belong to several companies, each fully separate, with a company switcher. Members get their own focused place; Settings stays minimal. MCP: invite, list, remove and change role.
- **Acceptance:** plan (data model and RLS, invite flow, roles, switcher) and mockup approved by the owner.

<a id="flow-602"></a>
### FLOW-602 · Rename a company
- **Type:** SMALL CYCLE · **Status:** done (#77 RPC and MCP, #82 screen; option A approved by the owner on 2026-10-07: the business name is its own Settings row that opens a one-field rename sheet, decision [0108](../decisions/0108-rename-company-row.md)) · **Depends on:** —
- **What:** An owner-only RPC and MCP tool `rename_company` (idempotency key, write bucket, undo). The in-app place is a small focused screen or sheet, not a Settings catch-all; it needs a quick mockup and can ship in a second PR.
- **Acceptance:** viewer refused, other company refused with a positive control, undo restores, TOOLS.md.

<a id="flow-604"></a>
### FLOW-604 · rename_company follow-ups (#77 review)
- **Type:** BACKLOG NIT · **Status:** done (#120) · **Depends on:** FLOW-602
- **What:** (1) The MCP length check counts UTF-16 units, SQL counts code points; align them. (2) SQL `btrim` strips only spaces while the MCP trims all whitespace; trim all whitespace and reject control characters in `rename_company`. (3) A direct table update can still set any name; add a not-valid check constraint for 2 to 100 characters, or revoke `update(name)` once the screen uses the RPC. (4) pgTAP: assert an `audit_log` row after the MCP rename and after undo, and cover the refused path.
- **Acceptance:** the same name is accepted or refused by the MCP, the RPC, and the table; audit rows tested.
- **Built (#120):** `private.trim_name` trims what JavaScript `trim()` trims and `private.company_name_problem` holds the rule (2 to 100 code points, no control character) for `rename_company` and `mcp_rename_company`; the MCP counts code points. (3) is a `before update of name` trigger, not a check constraint, so a name that already breaks the rule never blocks an update of another column; it refuses with `23514`.

<a id="flow-603"></a>
### FLOW-603 · Per-user cache isolation on a shared device
- **Type:** BUG · **Status:** done (#79) · **Depends on:** —
- **What:** Query cache keys are shared across users and the cache isn't cleared on sign-out; saved roles stay in localStorage after sign-out; the dashboard cache isn't user-scoped, so a user switch without a reload could show the wrong company's flag. Scope keys by user and company and clear on sign-out (including an expired session or another tab).
- **Acceptance:** tests for sign-out, a user switch without reload, and an expired session.

<a id="flow-606"></a>
### FLOW-606 · Company name rule in create_company and the rename sheet
- **Type:** BACKLOG NIT · **Status:** done (#131, #134) · **Depends on:** FLOW-604
- [x] `public.create_company` still trims spaces only, has no 100-character limit and accepts control characters. Use `private.trim_name` and `private.company_name_problem` there too (inserts are not checked by the FLOW-604 trigger). Until then, an MCP `undo` of a rename back to such an older name is `refused` by the trigger, and the app's ביטול is refused by the RPC. (Migration `20261008090000`. Companies created before it keep their names.)
- [x] The rename sheet's `companyNameError` does not refuse a control character, so a pasted tab gets the generic "שם העסק לא נשמר" toast. Add a field error (UI: through the Mercury thread). (#134: "תו לא נתמך בשם – למשל טאב או ירידת שורה", after trimming like `private.trim_name`, and the same check as a field error in onboarding and the setup business step, which now check the name before `create_company`.)

<a id="flow-605"></a>
### FLOW-605 · Shared-device follow-ups (#79 review)
- **Type:** BACKLOG NIT · **Status:** done (#131) · **Depends on:** —
- [x] Unsaved split drafts (the `flow-split:` sessionStorage keys) survive a sign-out in the same tab. Drop them when the user changes, with a test. (`app/src/split-drafts.ts`: the tab records the drafts' user and drops them on any other user, a reload included.)
- [x] `ToastProvider` wraps `AuthProvider`, so the last user's toast and its retry or undo action outlive a user switch. Swap the providers and add a test. (`SessionProviders`, used by the app and the stories.)

## Jev

<a id="flow-701"></a>
### FLOW-701 · Jev phase 1
- **Type:** PLAN FIRST · **Status:** done (parts 1-4 merged in #137, #143, #149, #160; approve-all dropped by the owner) · **Depends on:** —
- **What:** The proposed first phase: (1) make Jev run after syncs and learn from confirmations, and produce the shadow accuracy report on approved lines; (2) faster review (reasons, "approve all sure ones", income suggestions); (3) anomalies v1 in one list (SQL detects, Jev scores only candidates); (4) recurring patterns in SQL that feed missing bills and expected months. Also a review of other features where Jev can help. The numbers always come from SQL; Jev never approves ([0084](../decisions/0084-jev-auto-prefill.md)). A daily call cap per company in SQL and a usage log, since the provider has no spend cap.
- **Owner's answers (2026-10-08):** Jev runs after each bank sync, with a daily call cap per company; Jev's sure suggestions are reviewed one by one like every line, with no approve-all in the app (FLOW-324 dropped; MCP keeps `assign_expenses`); anomalies show as a flag on the review card, with no new screen; recurring patterns feed both missing-bill notices and expected future months.
- **Acceptance:** owner answers the plan's open questions, then one PR per item.

<a id="flow-702"></a>
### FLOW-702 · Jev auto mode
- **Type:** PLAN FIRST · **Status:** server side done (#200, decision 0145; plan approved by the owner 2026-10-08, plans/flow-702-jev-auto-mode.md in the project files); app part with a UI lane · **Depends on:** FLOW-703 (done, #177)
- **What:** When the mode is `auto` and confidence is at or above the threshold, pre-fill the tag marked as AI and undoable in one tap; anomalies above a level always go to review; the toggle is the kill switch. Needs atomic allocation writes first. Show the threshold as a percent choice only in auto mode.
- **Acceptance:** threshold edge tests; undo restores; audit trail.
- [x] Anomaly gate: no fill on a flagged line unless Jev scored the flag below 0.5 (decision [0145](../decisions/0145-jev-auto-mode.md)).
- [x] Income lines auto filled: project (no allocation) and income category.
- [x] `jev_prefills` audit row per fill, `undo_jev_prefill` and MCP `undo_jev_prefill`; `get_jev_status` adds `prefilled_today` and `prefilled_open`, `get_jev_suggestions` adds `prefilled`.
- [x] Threshold edge tests (at the threshold and 0.001 below, expense and income); off or shadow stops new fills.
- [ ] App (UI lane): Settings mode choice הצעות בלבד / מילוי אוטומטי with threshold chips 80/85/90/95% in auto only; "✦ מולא ע״י Jev" with בטל (`undo_jev_prefill`) on a filled card; a held flagged line shows its flag and no fill.

<a id="flow-703"></a>
### FLOW-703 · Jev corrections write-back
- **Type:** SMALL CYCLE · **Status:** done (server side, #177); app part with the UI lane · **Depends on:** —
- **What:** Write the owner's corrections back as training signal; confirm on main that saving a change sheet seeded with a Jev guess never turns that guess into a supplier rule by default; make the split approve path atomic; expose a "no project / overhead" choice to the model; consider finished projects for lines dated before the finish.
- **Acceptance:** tests for the seeded change sheet and the correction write.
- [x] A change sheet seeded with Jev's category starts with "לזכור לספק הזה" off, so saving never turns the guess into a supplier rule by default (#175).
- [x] The review card shows Jev's "no project" answer (`no_project` from `jev_suggestions`, server in #177) as "תקורה · ללא פרויקט" (word order from design review r1, so 320 keeps תקורה) with the Jev pill (#175).
- [x] Corrections as signal: the party history carries Jev's earlier suggestion and whether the owner corrected it (#177, decision [0139](../decisions/0139-jev-corrections.md)).
- [x] Auto prefill in one SQL call, `jev_prefill` (#177).
- [x] `approve_split_review(review, category)`: set the category and approve a split line in one call (#177).
- [x] A `none` project answer, never pre-filled, and the overhead project labelled (#177).
- [x] Finished projects offered on lines dated on or before their last line (#177).
- [x] #177 review nits (done in FLOW-702's server PR, decision 0145; a prefill does not set `pnl_role`): `jev_prefill` checks a finished project's date in SQL too; a line filed to the overhead project counts as a `no_project` match; the two-argument `approve_split_review` refuses an income or hidden category; drop the unused `PrefillWrite.allocation` and `categorySuggested`; decide whether a prefill sets `pnl_role` (a prefilled line stays unassigned until approved).
- [x] App (UI lane): the change sheet seeded with a Jev guess starts with remember off, with a test; the split approve calls `approve_split_review(p_id, p_category_id)` instead of two calls; show `no_project` on the card. Done in #175: remember off (above), one `approve_split_review(p_id, p_category_id)` call, `no_project` on the card.

<a id="flow-704"></a>
### FLOW-704 · Jev review card follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] If the flag read stalls past 1s while Jev is on, the card swaps back and writes the flag off; a flag that's off while Jev is on leaves one approvable read on the next launch; the 5-minute flag cache delays a server-side change; each next card waits about 0.8s again during a long stall.
- [ ] A Jev-filled card still shrinks about 30px when it settles; reserve the note height with the text hidden.
- [ ] When the Jev scope appears after mount, the card re-reads once; a queue-level test that the query key carries the scope; the scope binding is a side effect during render.
- [ ] A test that fails if the live-read wait is removed; a provider-level test for a user switch without sign-out; return `company_id` from `list_review` so a failed company lookup still uses the remembered flag. (Server part done: each `list_review` row has `company_id`, which `companyIdFromReviewPayload` already reads.)
- [ ] Delete the old shared connector key once per launch, not on every read.
- [ ] Jev Settings row: reserve the options slot only when the last known state was on; announce the switch state; mark the loading row busy; an open/closed chevron on אפשרויות; a "no key" status once a key-status RPC exists.
- [x] Jev tagging job: a cron with a DB run lease, persisted usage per run. (FLOW-701 part 1, decision [0124](../decisions/0124-jev-after-sync.md).)
- [x] The review card marks a project or category Jev filled with "✦ הצעת Jev" (the shared `JevTag`) instead of הצעה (2026-10-08, #141).
- [ ] שינוי שיוך and the statement row still show הצעה, or ✦ alone, on a Jev fill.

## Infra and CI


<a id="flow-705"></a>
### FLOW-705 · Jev anomalies follow-ups (#160 review)
- **Type:** BACKLOG NIT · **Status:** done · **Depends on:** —
- [x] A voided credit note still suppresses a duplicate flag. (#168)
- [x] An income receipt that pays several invoices can be flagged as a spike. (#168)
- [x] pgTAP cases for a pending line, two loans and an uneven median. (`jev_anomaly_cases.test.sql`.)
- [x] `mcp_review_anomalies` scans many rows when few lines are open. (#168)
<a id="flow-706"></a>
### FLOW-706 · Jev fills can't be undone from the app while Jev is off
- **Type:** BUG · **Status:** claimed (UI lane 4, 2026-10-09) · **Depends on:** — · **Source:** #231 code review
- **What:** Decision 0145 says fills already made stay undoable after the owner turns Jev off. The app reads `jev_prefills` only inside the Jev suggestion read, which runs only while the connector is on, so with Jev off a filled line shows no "✦ מולא ע״י Jev" and no בטל (MCP `undo_jev_prefill` still works). App only, no server change: read the newest standing fill per open line even when the connector is off, show the label with בטל, and keep the stored values (no visual fill).
- **Acceptance:** a queue test with the connector off and a standing fill shows the label and בטל calls `undo_jev_prefill`; design review.

<a id="flow-801"></a>
### FLOW-801 · Backups and restore tests
- **Type:** PLAN FIRST · **Status:** on-hold (the owner chose "Not now" on the plan, 2026-10-08; plan: nightly age-encrypted pg_dump to R2 with a weekly restore test) · **Depends on:** —
- **What:** From the original plan: a nightly encrypted dump to off-site storage with failure alerts, a weekly storage sync, a monthly restore test (row counts and P&L checksums), and a quarterly drill runbook.
- **Acceptance:** plan approved (storage, keys, cost); seven nightly dumps; an alert fires on a forced failure.

<a id="flow-802"></a>
### FLOW-802 · Health check and usage monitoring
- **Type:** PLAN FIRST · **Status:** on-hold (owner chose "Not now", 2026-10-08; built in #237 and reverted; migration 20261012020000 drops `private.health()` again, since merged migrations stay; the plan is the project's plans/flow-802-health-check.md, and the code can come back by reverting the revert) · **Depends on:** —
- **What:** A `health()` RPC and a daily health-check workflow (stuck queues, cron runs, last sync), usage alerts against the free-tier limits, and a move-to-paid-plan runbook.
- **Acceptance:** an alert on a simulated stuck queue.

<a id="flow-803"></a>
### FLOW-803 · Security review pass
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** CSP and XSS audit, RLS and storage policy review, service-role usage audit, redaction check, a key-rotation drill.
- **Acceptance:** checklist signed off; findings filed as tasks.

<a id="flow-804"></a>
### FLOW-804 · Performance pass
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** A bundle budget with a CI check (Home route target), Lighthouse CI, real-user timings, and Hebrew mobile flows in Playwright.
- **Acceptance:** Home usable within 2 seconds on a throttled mid-range profile ([0034](../decisions/0034-cost-and-load-limits.md)).

<a id="flow-805"></a>
### FLOW-805 · Offline action queue
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** Queue writes made offline and replay them with a client operation id, applied exactly once.
- **Acceptance:** plan approved; replay tests.

<a id="flow-806"></a>
### FLOW-806 · Privacy policy, terms and account deletion
- **Type:** PLAN FIRST · **Status:** on-hold (owner and legal review) · **Depends on:** FLOW-801
- **What:** Hebrew privacy policy and terms, and a deletion flow with tombstones.
- **Acceptance:** reviewed text live.

<a id="flow-807"></a>
### FLOW-807 · Split the big screens file
- **Type:** SMALL CYCLE · **Status:** done (#219, #225, #227, #229, #232, #235, then the `flow-mcp/tools.ts` split: no hand-written source file is over 800 lines; test files over the 1,200 test limit remain) · **Depends on:** — (best between feature PRs, it conflicts with everything)
- **What:** `app/src/screens/flow-screens.tsx` holds most screens in one file, so builders read too much and PRs conflict. Move each screen to its own file with no behaviour change.
- **Acceptance:** no snapshot or test changes besides imports; bundle size unchanged within noise.

<a id="flow-808"></a>
### FLOW-808 · Shared test fixtures and pitfalls upkeep
- **Type:** SMALL CYCLE · **Status:** done (#181: `tests.fixture_*` in `supabase/tests/helpers.sql`, PITFALLS findings 19 to 31, code checklist) · **Depends on:** —
- **What:** Commit shared invented test fixtures so builders stop re-creating them, and fold the pending pitfall candidates from recent retros into [PITFALLS](../review/PITFALLS.md) and the checklists. Themes: a consumer matrix for every payload a contract change touches; a unit or currency change reaches every sum; two PRs redefining one SQL function agree the order up front; never cache constraint or transient refusals in an idempotency store; security-relaxing columns are never owner-writable; every auth path gets a wrong-value negative test; probe a restricted role against every write path; fixed-timeout e2e waits are flakes; a fix needs a test that fails when it is reverted; a persisted flag is a hint, not confirmation; don't peek at another feature's query with a second observer; renames of ops-visible objects need an "Ops changes" PR section.
- **Acceptance:** PITFALLS and checklists updated; changelog.

<a id="flow-809"></a>
### FLOW-809 · Public Storybook per PR head for reviewers
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** Reviewers can't download CI artifacts without a login. Publish the built Storybook (sample data only) per PR head, so design re-reviews cover only the changed stories.
- **Acceptance:** owner approves the hosting; no real data or hosted keys in the published build.

<a id="flow-810"></a>
### FLOW-810 · Clip check follow-ups and 320px clipping
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Re-run the real clip check on main and record the exit code and per-class table; fix the remaining clipped stories at 320.
- [ ] Skip hidden or screen-reader-only text when measuring, including descendants; widen the 1×1 check (`clip: rect(0…)`, `clip-path: inset(50%)`, `.sr-only`).
- [ ] De-duplicate nested-block lines; measure `clip-no-text` stories but waive only the zero rule.
- [ ] Freeze the date in date-relative stories so clip results don't drift.
- [ ] Long supplier names need `overflow-wrap: anywhere` on the review supplier line; older truncations in the project picker, unpaid hints and the add-sheet hint; a stress story with a 3-line supplier.
- [ ] A per-story retry; a story whose sample totals don't add up.

<a id="flow-811"></a>
### FLOW-811 · CI and deploy follow-ups
- **Type:** BACKLOG NIT · **Status:** done (this PR) except the Dependabot item · **Depends on:** —
- [x] Migration checker: scan nested dollar-quoted bodies and commits inside DO or function bodies; don't flag `begin atomic`; flag unwrapped create/drop index. (A nested body after `do` or `as` is now scanned too; the other three were already in.)
- [x] Record the production row-hash baseline query in a script, so a baseline can be recomputed after a deploy. (`scripts/prod-row-hash.sh`: prints the baseline, or compares with one; runbook "Row-hash baseline".)
- [ ] If Dependabot is added, give it the fixture deny-list secret (CI fails closed without it). (Not now: there is no Dependabot.)
- [x] Optional: indexes for composite foreign keys without a matching index (advisor info). (34 indexes cover the 35 keys the advisor listed; a pgTAP test fails on a new foreign key without one.)
- [x] Smoke: a failure message on the sheet-stack scrim check; anchor the auth allowlist to the Supabase host; a unit test for the reporter. (The scrim check already had its message. The write guard moved to `e2e/smoke-allow.ts`: the auth, status and list-RPC POSTs pass only on the Supabase origin. Unit tests for it and the reporter.)
- [x] Add `supabase migration repair` to the CI/CD runbook. (Already in `docs/runbooks/ci-cd.md`.)
- [x] Consider per-PR changelog fragments; `docs/changelog.md` conflicts on almost every parallel PR. (`docs/changelog.d`.)

<a id="flow-812"></a>
### FLOW-812 · Faster CI
- **Type:** SMALL CYCLE · **Status:** in review (dev lane 1; the 2026-10-07 claim on claude/project-thread-uiob2d was stale: branch gone, its PRs closed) · **Depends on:** —
- **What:** Pull requests have no GitHub CI since #106; main runs the suite before each batch deploy. Run 883 (2026-10-09) took 9.9 minutes from plan to the end of deploy, and the every-story shards (5.6 minutes each, 4 of the 8 story groups per runner) and e2e shard 1 (database checks, then half the Playwright suite) set the pace. Split the every-story smoke into 4 runners and the main Playwright suite into 3; shard 1 keeps the database checks.
- **Acceptance:** Same tests run; the required check names stay `lint`, `check`, `e2e`; main's run (plan to deployed) drops by at least a fifth.

<a id="flow-813"></a>
### FLOW-813 · Faster pre-push local CI
- **Type:** SMALL CYCLE · **Status:** done (this PR) · **Depends on:** —
- **What:** The pre-push run (`scripts/local-ci.sh`) took 4–5 minutes on every push: app unit tests 147s, lint 48s, Storybook 43s, the two builds about 45s, typecheck 17s (measured 2026-10-08). The default run now skips the typecheck, the builds, the app unit tests and Storybook when their inputs (git trees of app, packages, design, `_shared`, the migrations, scripts, the root configs and `.env`) already passed in this clone, runs only the app tests related to the files changed since the last green commit when only `.ts`/`.tsx` sources or migrations changed (plus the tests that glob the migrations), and runs the server tests beside the static checks. `--full` and `FLOW_LOCAL_CI_NO_SKIP=1` run everything.
- **Measured:** cold 247s; a push that leaves the app unchanged (server, docs, tests) 53s; a one-file app change 148s (39 related unit files, 17 story files).
- **Follow-up (e2e for the touched screens):** the default run now also runs the e2e specs that reach the files changed since the last commit whose specs passed in this clone (or since main). `app/e2e/spec-sources.json` maps each spec to the screens it opens; `scripts/e2e-specs.mjs` follows their imports (the screens barrel by name, `@flow/shared` too), and `App.tsx`, `dev-routes.tsx`, CSS and the e2e config run every spec. A test fails when a new spec is not in the map. It needs Docker: local Supabase starts (or resets) in the background while lint runs; without Docker the run names the specs it left to main. Specs run with `--fully-parallel` on Playwright's default workers (on every core a toast timing spec timed out). A run without Docker does not move the next run's base, so the skipped specs come back.
- **Measured (4 cores, 2 workers):** all 22 specs 5.6 min (gate 619s); a copy change in one screen (`jev-settings.tsx`) picks 9 specs, 3.6 min, and the whole gate takes 391s; server, docs and test-only pushes pick none. **Trade-off:** a screen change now costs about 3.5 more minutes, over the 4-minute budget, because `controls.spec.ts` (70 tests, 285s of test time) opens nearly every screen. Splitting it by screen is the next saving.
- **Controls split:** the no-op sweep (41 routes, about 207s of the 285s in `controls.spec.ts`) moved into four specs by screen sharing `app/e2e/control-sweep.ts`, so a screen change runs one sweep file, not all of them. The functional controls tests stay in `controls.spec.ts`.
- **Next:** lint (48s, type-aware) bounds the fast path; a shared green cache (`FLOW_LOCAL_CI_CACHE`) would let one lane's pass count for another.

## Data hygiene (public repo)

<a id="flow-901"></a>
### FLOW-901 · Deny-list test coverage gaps
- **Type:** SMALL CYCLE · **Status:** ready · **Depends on:** —
- **What:** The fixture deny-list test misses connector rule files, subfolders and non-`.ts` top-level files; entries over 6 words never match; n-grams should cover 4+ words and strip punctuation. Extend it to scan `docs/`, stories and e2e too.
- **Acceptance:** a planted invented name in each new path fails the test.

<a id="flow-902"></a>
### FLOW-902 · Replace the deny-listed supplier word
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- **What:** One deny-listed supplier word still appears in about 30 places (demo data, docs, e2e). Replace it with invented names and keep the matching test arguments in sync.
- **Acceptance:** 0 deny-list hits; tests pass.

<a id="flow-903"></a>
### FLOW-903 · Generated Mercury fixtures
- **Type:** SMALL CYCLE · **Status:** done (#186) · **Depends on:** —
- **What:** Regenerate the Mercury fixtures from a seeded generator script committed to the repo, so they can be rebuilt from scratch, and fix the fixtures README wording.
- **Acceptance:** the generator reproduces the fixtures byte for byte; same edge cases covered.

<a id="flow-904"></a>
### FLOW-904 · Sync the CI deny-list secret
- **Type:** SMALL CYCLE · **Status:** blocked (needs the owner's GitHub access) · **Depends on:** —
- **What:** Merge the maintained deny-list into the CI secret without dropping existing entries.
- **Acceptance:** CI deny-list test still green; nothing printed.

<a id="flow-905"></a>
### FLOW-905 · Example data in the rendered design screens
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- **What:** Re-render the Settings design PNGs (`design/screens/14-settings-{light,dark}.png`) with an example.com address.
- **Acceptance:** regenerated from source; changelog.

<a id="flow-906"></a>
### FLOW-906 · Confirm the public help contact
- **Type:** BACKLOG NIT · **Status:** on-hold (owner) · **Depends on:** —
- **What:** Confirm that the help contact in `app/src/config.ts`, one story and three docs is meant to be public, or replace it.

<a id="flow-907"></a>
### FLOW-907 · Data clean-up after PR B
- **Type:** MCP · **Status:** blocked on the owner's approval · **Depends on:** FLOW-101 (done, #70)
- **What:** Data work for the MCP/data agent, no code: re-check company totals after FLOW-101; hide default loan categories a company doesn't use (the interest category is the target for split interest, so check after PR B); move deposit and closing returns filed as refunds into a kept-out category if the owner approves.
- **Acceptance:** the data agent reports before and after totals to the coordinator.

## Done

Recently finished tasks move here with their PR, so the history stays readable. Older history is in [docs/changelog.md](../changelog.md).

| Id | Title | PR |
| --- | --- | --- |
| FLOW-209 | get_project follow-ups (#90 review) | #126 |
| FLOW-130 | Lock timeouts return retry in every MCP write (#123 review) | #124 |
| FLOW-120 | Loan project follow-ups (#89 review) | #121 |
| FLOW-104 | Reversals across directions | #76 |
| FLOW-101 | Loan payments count by their split parts | #70 |
| — | Categories kept out of the P&L, `set_category_pnl` | #67 |
| — | MCP `get_project` with a basis parameter | #66 |
| — | MCP `assign_expense_split` | #68 |
