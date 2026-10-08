# Flow backlog

Open tasks only. How to claim and finish a task is in the [backlog guide](README.md). Keep each task's status line current; a claim lives in an open draft PR titled `FLOW-<id>: <title>`.

Types: `SMALL CYCLE` (one PR, no new screen), `SMALL UI` (one PR with a UI change, design review), `PLAN FIRST` (plan and mockup, owner approval before any build), `BUG`, `MCP` (flow-mcp work), `BACKLOG NIT` (reviewer follow-ups, batch several per PR).

Statuses: `ready`, `claimed`, `in-progress`, `plan-first`, `on-hold` (owner's go needed), `blocked`, `done`.

Last full sync: 2026-10-07.

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
| 25 | [FLOW-106](#flow-106) | More loan types and loan fields | PLAN FIRST | in-progress (parts 1-2 done #132 #151; part 3 in review) |
| 26 | [FLOW-701](#flow-701) | Jev phase 1 | PLAN FIRST | ready |
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
| 36 | [FLOW-125](#flow-125) | Loan split follow-ups (#83 review) | BACKLOG NIT | ready |
| 37 | [FLOW-123](#flow-123) | Loan balance checks follow-ups (#72 review) | BACKLOG NIT | done (#127) |
| 37b | [FLOW-131](#flow-131) | Loan balance checks follow-ups (#127 review) | BACKLOG NIT | done (#129, #134) |
| 37c | [FLOW-312](#flow-312) | Split-by-category follow-ups (FLOW-311) | BACKLOG NIT | done (#133, #136, #145) |
| 37d | [FLOW-133](#flow-133) | Batch undo by write id; split undo keeps percent and rest (#145 review) | BACKLOG NIT | ready |
| 37e | [FLOW-132](#flow-132) | Closed loan follow-ups (#132 review) | BACKLOG NIT | ready |
| 37f | [FLOW-134](#flow-134) | Loan part categories follow-ups (FLOW-106 part 2 review) | BACKLOG NIT | ready |
| 38 | [FLOW-313](#flow-313) | Month dividers follow-ups (#98 review) | BACKLOG NIT | ready |
| 39 | [FLOW-314](#flow-314) | Swipe between transactions on the card | SMALL UI | ready |
| 40 | [FLOW-124](#flow-124) | One line out of the P&L follow-ups (#105) | SMALL UI | ready |
| 41 | [FLOW-319](#flow-319) | Type sizes, headers and text colours, income in green | SMALL UI | done (#111) |
| 42 | [FLOW-320](#flow-320) | Open the picker that was tapped on the transaction detail | SMALL UI | done (#125) |
| 43 | [FLOW-410](#flow-410) | Find every project in project search | BUG | done (#128) |
| 44 | [FLOW-321](#flow-321) | Two rows in Home's attention card (review and unpaid) | SMALL UI | done (#130) |
| 45 | [FLOW-322](#flow-322) | Copy and dead-end fixes from the UX review | SMALL UI | ready |
| 46 | [FLOW-411](#flow-411) | Project screen: lines on open, honest period label | SMALL UI | ready |
| 47 | [FLOW-323](#flow-323) | Search and all transactions | PLAN FIRST | plan-first |
| 48 | [FLOW-324](#flow-324) | Approve all suggestions in the review queue | PLAN FIRST | dropped (owner, 2026-10-08) |
| 49 | [FLOW-325](#flow-325) | Split a refund across projects and categories by percent or amount | MCP | in-progress (server); app screen plan-first |
| 50 | [FLOW-326](#flow-326) | Screen titles and row text on the start side | SMALL UI | ready |
| 51 | [FLOW-327](#flow-327) | Review card: actions in the thumb zone, tidy spacing | SMALL UI | ready |
| 52 | [FLOW-328](#flow-328) | Mobile UI consistency pass (cycle 1) | SMALL UI | ready |
| 53 | [FLOW-329](#flow-329) | Out of the P&L as a visible row on the transaction | SMALL UI | ready |
| 54 | [FLOW-330](#flow-330) | Mark paid that stays marked | SMALL CYCLE | ready (owner chose: store it) |
| 55 | [FLOW-331](#flow-331) | A useful + tab while capture is not built | SMALL UI | ready (owner chose: quick actions) |
| 56 | [FLOW-332](#flow-332) | Swipe back from the edge on pushed screens | SMALL UI | ready (owner approved) |

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
- **What:** Follow-up from FLOW-112. `app/src/screens/loan-match.tsx` reads the three loan categories with `.in("name", ...)` and offers a match when the line's category name equals the principal name; the Mercury connector's loan hint resolves `תשלומי הלוואה` by name; the categories screen's locked loan line (`loanCategoryLine` in `app/src/screens/flow-screens.tsx`, FLOW-113) matches the Hebrew names too. Read `categories.loan_part` instead. No visible change.
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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-107
- [ ] Transaction rows in the category drill-down, a project's recent list and "שויכו היום" always pass `source="invoice"` (`app/src/screens/flow-screens.tsx`), so bank lines show the document icon. Have the list reads return the line's source and pass it on; do not special-case loan rows.
- [ ] A Latin row title is cut at its start in an RTL row at 320 ("…gate Home Loans"). Use `dir="auto"` on `.ui-row-title`, or `ltrTitle` when the description is Latin.
- [ ] "3 חלקים" is a fixed string (`app/src/screens/loan-marks.tsx`). Carry the real part count in the mark if a split can ever have fewer or more parts.

<a id="flow-108"></a>
### FLOW-108 · Take a single transaction out of the P&L, with an MCP batch
- **Type:** PLAN FIRST · **Status:** done (#105) · **Depends on:** #67 (merged)
- **Approved:** 2026-10-07, the design reviewer's option A of the [mockups](https://claude.ai/artifact/QPLXZjbEdoy8x2H49EEuYS) (עוד sheet button, ⊘ pill, save on tap with ביטול; loan lines locked), under the owner's standing rule for UI tasks. Decision [0112](../decisions/0112-line-out-of-pnl.md).
- **What:** Let the user move one expense or income line out of the P&L. It then shows in a visible "out expenses" / "out income" group (not hidden), and can move back anytime. A per-transaction override wins over the category default. MCP: a single tool and a batch tool to take out or restore many lines at once, with idempotency, the write bucket, `undo` and `undo_batch`; plus an API. Icon-based, minimal wording.
- **Acceptance:** plan and mockup approved by the owner, then: pgTAP for override precedence on both bases, totals moved to the excluded side, batch partial success and batch undo.

<a id="flow-124"></a>
### FLOW-124 · One line out of the P&L follow-ups (#105)
- **Type:** SMALL UI · **Status:** ready · **Depends on:** FLOW-108 (#105)
- [ ] Transaction lists (project recent list, category drill-down, לאישור, שויכו היום, breakdown lines) don't mark a line taken out of the P&L. Return the flag from the list reads and show the ⊘ mark through `ListRow` `tag`, like the categories screen.
- [ ] A line split by category: `get_transaction`'s `in_pnl`, `category_excluded_from_pnl` and `pnl_fixed` read the line's own category, not its parts, and the card works out `out` from the override and that flag instead of the server's `in_pnl`. A split line whose parts are partly kept out shows no pill and the hint names the line's category. Return a per-line state for split lines (all in, all out, mixed) and drive the pill and hint from it.
- [ ] Stories: open the עוד sheet with a play function so clip-check measures its text, and add the other states: category kept out (hint names it), a line forced back in ("ברווח והפסד" pill), the locked loan line, and the split-line hint.

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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-106 part 1 (#132)
- [ ] A removed line dated after a loan's `closed_on` keeps its parts; if it comes back it counts against the closed loan without a check. Check it when the line is restored, as decision 0121 does for the balance.
- [ ] Changing an attached line's `doc_date` to after its loan's `closed_on` is not checked.
- [ ] `get_project`'s `loans[]` has no `status`, so a project lists paid-off and closed loans next to open ones.

<a id="flow-134"></a>
### FLOW-134 · Loan part categories follow-ups (FLOW-106 part 2 review)
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-106 part 2
- [ ] `merge_category` does not move `loans.*_category_id`, so a loan keeps filing new parts under the hidden source category. Move them in the merge (the target must fit the part) or refuse the merge.
- [ ] The categories screen shows a generic error when a flip is refused with `loan category is fixed` for a category a loan uses; give it copy (Mercury UI thread).
- [ ] The match sheet offers a loan only for lines on the keyed principal category (`offerMatch` in `loan-match.tsx`); also offer it on a loan's own principal category (Mercury UI thread).
- [ ] `mcp_update_loan` repeats the fit check for each part; one loop over the three keys would do. The loans trigger also runs on every `update_loan` and `loan_update` undo, since they always set the three columns.

<a id="flow-106"></a>
### FLOW-106 · More loan types and loan fields
- **Type:** PLAN FIRST · **Status:** in-progress (parts 1-2 done #132 #151; part 3 in review) · **Depends on:** — · **Owner's approval:** 2026-10-08, the whole plan ("Approve all")
- **What:** Gaps found while setting up real mortgages: (a) balloon, interest-only and demand notes (no term, variable prime-linked rate); (b) a closed or paid-off status for historical loans; (c) attach a payment that includes fees and several missed installments; (d) per-loan category mapping for the split parts instead of the Hebrew defaults. MCP-first for each.
- **Plan (approved):** one PR at a time, MCP first, in this order. Screen fields go to the Mercury UI thread once the MCP side is merged.
  1. (b) `loans.status` (`open`, `paid_off`, `closed`) and `closed_on`, set with `update_loan`; a closed loan takes only payments dated on or before `closed_on`.
  2. (d) Per-loan categories for the parts (null keeps the defaults); interest, escrow and fees go to any expense category in the P&L, principal to one kept out.
  3. (c) A fourth part `fees`; `attach_loan_payment` takes `installments` (1 to 12) or exact `parts` that add up to the line.
  4. (a) `loans.kind` (`amortizing`, `interest_only`, `balloon`, `demand`), a `loan_rates` table and `set_loan_rate`. Demand interest is daily on actual/365; rates are entered by hand. Loan draws are out of scope.
- **Acceptance:** plan approved, then one PR per item with schedule tests at the boundaries.

<a id="flow-110"></a>
### FLOW-110 · Loans list and detail
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** FLOW-501 (where loans live)
- **What:** (1) Reorder loans (persisted order). (2) Edit and delete on each loan, with a confirm for delete. (3) A loan detail page with its attached payments (principal, interest, escrow, fees) linked to the bank rows. MCP: `reorder_loan`, `delete_loan` (update and list exist).
- **Acceptance:** mockup approved; MCP tools with undo.

<a id="flow-114"></a>
### FLOW-114 · Loans server follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] `ratioToPayment` divides by the payment including escrow (`packages/shared/src/loan-schedule.ts`), while the balloon test uses principal and interest only.
- [ ] `loan_balances.flagged_parts` counts flagged parts on voided or removed lines.
- [ ] Revoke the unnecessary `service_role` EXECUTE grant on `public.clear_loan_split_review`.
- [ ] Backfill existing loan lines into `loans` / `loan_splits`.
- [ ] A company with a hidden or kept-out `מסים וביטוח` category fails on escrow.
- [ ] Date formatting for years below 1000.
- [ ] Loan match: do the split correction in one server call; check the remaining balance on the server; P&L cache keys after a match; an unmatch flow and a category lock on a matched payment; avoid a split read on every expense view.
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
- [ ] Undo ignores `review_queue.prior_*` and `reassign_undo.prior_*` that still point at the row.
- [ ] Names accept control and invisible characters.
- [ ] A second hide returns the generic refusal; if the app unhides a category the MCP hid, the MCP can neither re-hide nor undo.
- [ ] TOOLS.md conflict wording, and document the `sync_bank` errors.
- [ ] `mercury-sync` `deno check` doesn't resolve imports (also on main).
- [ ] A post-deploy smoke for `mercury-sync` `auth.getUser()` with an MCP token.
- [ ] `private.mcp_batches` token FK lacks `ON DELETE CASCADE`; the SQL uuid check is lowercase-only while zod accepts any case; `remember` is silently ignored on category-only batch rows.
- [ ] A race test (dblink pgTAP or e2e) for the undo row lock.
- [ ] Owner fallback in `_shared/owner.ts`: accept it only for flow-mcp tokens, match the token's company claim, share one JWT decoder with `flow-mcp/sign.ts`.
- [ ] The MCP review schema still requires `project_id` for kept-out income that doesn't need one.

<a id="flow-206"></a>
### FLOW-206 · Bulk setup without rate-limit stalls
- **Type:** MCP · **Status:** done (#119) · **Depends on:** —
- **What:** `create_project` and `create_category` hit HTTP 429 after about 10 calls in a row during a company setup. Add batch create tools (like `assign_expenses`) or a higher burst for setup. Also send the MCP `tools/list_changed` notification so clients refresh a stale tool list after a deploy.
- **Acceptance:** a setup of 30 projects and categories runs without a 429; tests for the batch and the notification.

<a id="flow-210"></a>
### FLOW-210 · Bulk setup follow-ups (#119 review)
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-206 (#119)
- [ ] pgTAP: `undo_batch` of a created project or category that a line already uses is `conflict` for that row; `create_projects` with `status: "finished"`.

<a id="flow-207"></a>
### FLOW-207 · sync_bank job follow-ups (#75 review)
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] `mcp_sync_bank_finish` accepts any 1–200 character failure message for a known code; allow-list the fixed strings the edge sends, like `mcp_refused`.
- [ ] `private.mcp_sync_jobs` has no retention; add a cleanup for finished jobs.
- [ ] A handler-level test that `get_sync_status` takes the read rate bucket and that a write-only token can call it through `handle()`.
- [ ] Deploy order: between the migration and the edge deploy, a pull's result is lost (the job reads retry after 5 minutes) or `sync_bank` is refused. Note it in the deploy steps.

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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-312 (#145)
- [ ] `undo_batch` undoes a `line_split` (an `assign_expenses` `parts[]` row) or `line_pnl` (`set_lines_pnl`) row through `mcp_undo(kind, transaction_id)`, which picks the newest live write on that line, not the batch's own. A later `split_line` / `set_line_pnl` on the same line is undone instead and the row reads ok. Return the `private.mcp_writes` id from `mcp_split_line` and `mcp_set_line_pnl`, store it in `row_writes`, and make the batch row `conflict` when a newer live write of that kind exists on the line.
- [ ] `mcp_undo('line_split')` and `private.line_split_parts` drop `percent` and `is_rest` (added in `20261008140000`), so an undone split comes back without its percent and rest markers.
- [ ] An `assign_expenses` `parts[]` row returns no stored parts; consider returning the cents as `split_line` does.

<a id="flow-312"></a>
### FLOW-312 · Split-by-category follow-ups (FLOW-311)
- **Type:** BACKLOG NIT · **Status:** done (items 1 and 6 in #133, item 2 in #136, item 5 in #145; items 3 and 4 moved to FLOW-325) · **Depends on:** FLOW-311
- [x] `get_project.transactions` lists only lines filed to or shared with the project, not lines that reach it through a part. (#133)
- [x] A bank re-sync that changes a split line's amount makes it count whole silently; open a review item (like the loan split `needs_review` flag) instead. (#136: an open `split_mismatch` review, decision [0125](../decisions/0125-split-line-resync-review.md). The review card has no special text for it yet; a hint goes to the Mercury thread.)
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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** FLOW-302 (#98)
- [ ] The month totals add rows by direction: a shared line counts at its full amount and a refund counts as income, so a month header is not that project's P&L for the month. Owner to decide whether that's fine or the header should follow the P&L rules (Decisions needed).
- [ ] Switching between the flat and the grouped list (a held order splitting a month, or a second month loading) remounts the rows, so a focused row loses focus.
- [ ] Screen readers hear the figures with no separator ("הוצאות −₪2,200הכנסות +$1,500"); add a pause between figures and lines.
- [ ] A month with large ILS and USD figures makes a three-line pinned bar (about 85px) at 320 to 390px; consider one currency per line only when needed.
- [ ] `MonthList` takes a `className` no caller passes; drop it or use it.

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
- [ ] `private.mask_long_digits` misses digit runs split by spaces or dashes; only matters if a writer other than Mercury's redactor stores a memo.
- [ ] `get_line_meta` uses `current_company_id`, so demo viewers get an empty list (same as `get_transaction`); re-check `card_last4` as 4 digits on read.
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
- [ ] A posted pending-income line leaves an open row with a null reason; a row marked changed still gets re-queued; income always reports `missing_project` even when the category is missing too; a connector invoice and its receipt both land in review.

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
- **Type:** SMALL UI · **Status:** ready · **Depends on:** —
- **What:** From the 2026-10-07 UX review: a period control on the group-lines screen and an empty state that offers choosing a period (today a dead end); singular copy for one waiting item on the breakdown; the detail's document-row hint names only what the row shows; the Review subtitle covers bank lines too; category rows in Settings open that category's lines; the `/notifications` route that nothing links to is removed or linked.
- **MCP:** none.
- **Acceptance:** each string in a test; no empty state is a dead end; a category row opens its lines; design review.

<a id="flow-323"></a>
### FLOW-323 · Search and all transactions
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** FLOW-302
- **What:** From the 2026-10-07 tap-count review: finding a line by supplier takes 4 to 6 taps and only inside the selected period. One list of every transaction with a focused search field and filter chips one tap away (income or expenses, project, category, period, waiting for review), reached from a search icon on Home and Projects. Options for the mockup: an entry icon only, or the review tab becomes a transactions tab with review as a filter.
- **MCP:** `search_expenses` and its RPC gain optional date, project, category and direction arguments (read only).
- **Acceptance:** plan and mockup approved; a line is 2 taps away after typing; results match `search_expenses`; tenant isolation test on the RPC. Overlaps FLOW-402, 303 and 305.

<a id="flow-324"></a>
### FLOW-324 · Approve all suggestions in the review queue
- **Type:** PLAN FIRST · **Status:** dropped · **Owner (2026-10-08):** no approve-all in the app; the owner reviews lines one by one. MCP keeps batch approve through `assign_expenses` as today. · **Depends on:** —
- **What:** The owner's ask (2026-10-08), to be planned first: an "approve all suggestions" button on the review queue, so a queue of lines that already carry a suggested project and category is cleared in one tap instead of one card at a time. The plan settles which lines count (both fields suggested, no split, no unallocated shared cost, no reversal, no loan line), what the button says with its count, a confirm or a toast with ביטול that restores every line, how a partial failure reads, and how it sits beside the list and the card. Overlaps the "approve all sure ones" item in FLOW-701.
- **MCP:** a batch approve over `list_review` items, matching the button's rules, or a documented reason to leave it to `assign_expenses`.
- **Acceptance:** plan and mockup approved; the rules for which lines are approved are written down; undo covers the whole batch; tenant isolation test on any new RPC.

<a id="flow-325"></a>
### FLOW-325 · Split a refund across projects and categories by percent or amount
- **Type:** MCP · **Status:** server in-progress (claude/project-thread-ljwbc6); app screen plan-first · **Depends on:** FLOW-311, FLOW-104
- **What:** The owner's ask (2026-10-08): select part of a refund (or any line) and split it between projects and categories by percent or fixed amounts, the rest staying where it was. Server: `save_line_split` and MCP `split_line` parts take `amount_minor`, `percent` (rounded together so the parts hit the line to the cent) or `rest: true` (the line's own category and project by default); a part of the other kind is a reversal (a refund back against expenses) and needs a project. Decision [0123](../decisions/0123-line-split-percent-rest-reversal.md). Takes over FLOW-312's reversal-part and app-screen items.
- **App:** a screen on the transaction detail to view and edit the parts, by percent or amount, with the rest shown live. Plan and mockup in the design thread, owner approval on a card before building.
- **Acceptance:** pgTAP for rounding, rest, reversal P&L effect and refusals; MCP tests; mockup approved; the screen's parts match `get_line_split`.
- [x] Parts screen server asks: preview (`p_preview`), `percent` and `rest` on `get_line_split`, named refusals for a repeated pair and a line of zero.
- [ ] (#135 review) `get_project.transactions[].parts_minor` sums parts unsigned; with reversal parts it should be signed by kind before the app screen shows it.
- [ ] (#135 review) A reversal part in a kept-out category still needs a project; 0103 lets a kept-out whole line skip it.
- [ ] (#135 review) A part with no project and one naming the line's own project are different pairs, so the same category and project can appear twice.

<a id="flow-326"></a>
### FLOW-326 · Screen titles and row text on the start side
- **Type:** SMALL UI · **Status:** ready · **Depends on:** — · **Source:** mobile UI/UX review cycle 1 (2026-10-08, D1, D2, D5, D16, D18)
- **What:** (1) On every screen with a Back control the title is pushed to the far left, away from its kicker (categories, connections, loans, unpaid, filed, project category, notifications, onboarding). `ScreenHeader`'s `.ui-page-title-row` uses `space-between`; put the title on the start side, Back on its own row as in mockups 07 and 14 (the existing `layout="stacked"` option may already do this). (2) `ListRow` rows rendered as `<button>` centre their label and hint (transaction detail project/category labels, connections status, add sheet rows): add `text-align: start` to `.ui-row`. (3) The settings switch row has no icon slot and a 600 title; give `Toggle` the row icon slot and the 400 row-title weight everywhere. (4) Help's Back is plain text; use the shared Back.
- **Acceptance:** shared components only (`screen-header.tsx`, `list-row.tsx`, `toggle.tsx`, `ui.css`); stories updated; clip-check at 320/360/390, light and dark; design review.

<a id="flow-327"></a>
### FLOW-327 · Review card: actions in the thumb zone, tidy spacing
- **Type:** SMALL UI · **Status:** ready · **Depends on:** — · **Overlaps:** FLOW-309, FLOW-315 · **Source:** cycle 1 (U3, U6, D3, D9, D12)
- **What:** Approving one card at a time is the most repeated job, and אישור moves between y=449 and y=584 depending on the card, with about 250px empty below; on a 375x667 phone with the banner, שינוי and דלג sit under the tab bar. Pin אישור / שינוי / דלג in a bar just above the tab bar; the card scrolls above it. Also: a gap of `--space-3`–`--space-4` between the auto-filed banner and the card (they touch today); label and value columns aligned on the card with tighter rows (mockup 03); the counter reads "1 מתוך 3" without padding spaces; a disabled אישור says why ("בחרו פרויקט וקטגוריה").
- [ ] (cycle 2, deploy 9ea1e9a) The "✦ הצעת Jev" pill trails each value, so on a card where Jev filled both fields the two pills start at different points; with values in an aligned column (above) the pills line up too.
- [ ] (cycle 2) At 320 the pill takes about 90px and long project or category names are cut to a few words ("וילה רעננה – …"). Let the name keep priority: wrap the pill under the value, or shorten it to "✦" with the full label as its accessible name.
- **Acceptance:** אישור at the same position on every card state at 375, 393, 412; nothing under the tab bar at 375x667; stories for plain, banner, shared-cost, disabled and Jev-filled cards; design review.

<a id="flow-328"></a>
### FLOW-328 · Mobile UI consistency pass (cycle 1)
- **Type:** SMALL UI · **Status:** ready · **Depends on:** FLOW-326 · **Source:** cycle 1 (D4, D6, D7, D8, D10, D11, D13, D14, D15, D17, U10, U11, U13)
- [ ] Change sheet rule preview: the arrow's space is inside the LTR bdi, so it renders on the wrong side ("ספק ␣␣←פרויקט"); spaces outside the bdi.
- [ ] Split screen: remove the hairlines between choices, 24px side gutter like other screens, amount on the start side.
- [ ] Install screen: remove step hairlines and centre the number circles on their text.
- [ ] Change sheet: values at the same weight as the transaction detail; title-to-subtitle gap as mockup 06.
- [ ] Project screen: more space between the band and the overhead switch (mockup 02).
- [ ] Empty and error states use the standard button, not a 36px pill, and match each other.
- [ ] The "מצב תצוגה" tag on the band sits on the start side, clear of the curve.
- [ ] No minus sign on a figure already labelled expenses (project band, category rows).
- [ ] Status chip "שולם" carries the ✓ like mockup 10.
- [ ] Notifications uses the shared EmptyState, Hebrew only.
- [ ] Amounts in lists in whole units; agorot only when non-zero, on detail and edit fields (§3.5).
- [ ] Transaction list rows carry the trailing chevron, then drop the "אפשר לפתוח כל תנועה" explainer.
- [ ] Empty Home names bank or SUMIT ("חיבור בנק או SUMIT"), opening the connections page.
- **Acceptance:** shared components and stories; clip-check; design review.

<a id="flow-329"></a>
### FLOW-329 · Out of the P&L as a visible row on the transaction
- **Type:** SMALL UI · **Status:** ready · **Depends on:** — · **Overlaps:** FLOW-124 · **Source:** cycle 1 (U5, D15)
- **What:** On the transaction detail, the only way to take a line out of the P&L is an unlabelled ⋯ at the top-left corner, the hardest spot to reach one-handed. Show a "ברווח והפסד" switch row under the category row; keep ⋯ only for delete. Move "פיצול בין פרויקטים" to the bottom of the screen, in the thumb zone.
- **Acceptance:** out-of-P&L is one tap on the detail and reversible; ⋯ shows only when delete applies; tests; design review.

<a id="flow-330"></a>
### FLOW-330 · Mark paid that stays marked
- **Type:** SMALL CYCLE · **Status:** ready · **Owner (2026-10-08):** option (a), store it · **Depends on:** — · **Source:** cycle 1 (U4)
- **What:** On Unpaid, "סימון כשולם" takes 2 taps (the button, then הבנתי) and then only hides the row in screen state (`flow-screens.tsx` `setHidden`): the unpaid total never drops (it sums every row), and after a reload the row is back. Options: (a) store a "marked paid, waiting for SUMIT" flag on the server; the row leaves the total and shows "סומן כשולם · ממתין לסנכרון" until the next sync; (b) keep it as a reminder and rename the button to say so, showing the explainer once.
- **MCP:** for (a), the unpaid tools return and can set the flag.
- **Acceptance:** a marked row stays marked after reload; total matches the list; tenant isolation test on any new RPC.

<a id="flow-331"></a>
### FLOW-331 · A useful + tab while capture is not built
- **Type:** SMALL UI · **Status:** ready · **Owner (2026-10-08):** quick actions (new project, new loan, connect a bank) · **Depends on:** — · **Overlaps:** FLOW-306 · **Source:** cycle 1 (U1, U7)
- **What:** The + in the middle of the tab bar is the best thumb spot in the app, and today it opens a sheet where both options are disabled. Until photo capture (FLOW-306) ships, + offers what works today: new project, new loan, connect a bank. "פרויקט חדש" then leaves the Projects header's top-left corner.
- **Acceptance:** no disabled-only sheet; design review.

<a id="flow-332"></a>
### FLOW-332 · Swipe back from the edge on pushed screens
- **Type:** SMALL UI · **Status:** ready · **Owner (2026-10-08):** approved · **Depends on:** — · **Overlaps:** FLOW-314 (gesture rules) · **Source:** cycle 1 (U2)
- **What:** In the installed iOS app there is no system back gesture, so the only way back from a pushed screen is the chevron at the top corner (y≈12–43). Add a swipe from the start (right) edge on pushed screens, with the same gesture rules as FLOW-314, so it never fights horizontal scrolling or the transaction swipe.
- **Acceptance:** works on every pushed screen; doesn't trigger inside sheets or horizontal lists; e2e test with touch.

## Projects and reports

<a id="flow-401"></a>
### FLOW-401 · Project view by category
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** Per project, expenses broken down by category with every line visible under its category (no extra taps or "show more"), category consolidation (for example all utilities under one group), a monthly expected amount per category from earlier months, and an alert when a month looks off (a new or missing recurring expense, or an amount well above usual). The math is plain SQL (median of the last 3–6 months, threshold rules); Jev only phrases. MCP: tools for the breakdown, the expected amounts and the anomaly list.
- **Acceptance:** plan and mockup approved.

<a id="flow-402"></a>
### FLOW-402 · All transactions of a project, at a glance
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** FLOW-302
- **What:** Tapping "תנועות אחרונות ›" on a project opens a full page with all the project's transactions, with filters by date and category. Polish the project and company cards so everything is reviewable with fewer taps. MCP: `search_expenses` already covers the data.
- **Acceptance:** mockup approved.

<a id="flow-403"></a>
### FLOW-403 · Project timeline and expected months
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** FLOW-401
- **What:** Transactions by a chosen date range (for example last month), plus expected future months from past data, computed in SQL. Shares the recurring-pattern base with FLOW-701.
- **Acceptance:** plan approved.

<a id="flow-404"></a>
### FLOW-404 · Project as an investment
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** FLOW-105
- **What:** Per property or project: purchase price, after-repair value, and from Flow's actual costs, forced equity (ARV − purchase − rehab) and current equity (value − loan balance). MCP tools to set and read purchase price, ARV and value.
- **Acceptance:** UX research, mockup and plan approved by the owner.

<a id="flow-405"></a>
### FLOW-405 · Category management
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** A clear place for a new user to set up their own categories. Deleting a category that has lines is allowed: warn with the count, then move its lines to untagged (back to review). A bulk "move all to another category". Replaces [0008](../decisions/0008-flat-categories-hide-or-merge.md)'s "delete only when empty" (new decision).
- **Acceptance:** mockup approved; MCP tools for delete and bulk move with undo.

<a id="flow-406"></a>
### FLOW-406 · Sub-categories and project groups
- **Type:** PLAN FIRST · **Status:** on-hold (owner: not this cycle) · **Depends on:** FLOW-405
- **What:** One level of sub-categories with a parent rollup; project groups (unit, building, portfolio); industry templates in setup that seed categories.
- **Acceptance:** owner's go, then a plan.

<a id="flow-407"></a>
### FLOW-407 · Export for the accountant
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** From the original plan: an Excel/CSV export with Hebrew headers and net plus VAT columns, carrying each line's original currency and rate date. MCP: an export tool.
- **Acceptance:** opens correctly in Excel; numbers match the P&L for the period.

<a id="flow-408"></a>
### FLOW-408 · Currency alignment in project lists
- **Type:** SMALL UI · **Status:** ready · **Depends on:** —
- [ ] In mixed-currency projects, the non-tappable USD category rows sit 32px further out than the tappable ILS rows. Reserve the chevron space so the amount column lines up.
- [ ] Verify on main: project rows accept a currency in `list-row.tsx` but never use it, and some list rows (project detail, filed today, project waiting, project category) may drop the currency. Fix any that still do.

<a id="flow-409"></a>
### FLOW-409 · Overhead weights on the cash basis
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] The overhead split weights by invoiced income even on the cash form of `get_project`.
- [ ] No pgTAP for the ILS filter in `get_home` and `get_project`.

<a id="flow-410"></a>
### FLOW-410 · Find every project in project search
- **Type:** BUG · **Status:** done (#128) · **Depends on:** —
- **What:** From the 2026-10-07 tap-count review. Project search doesn't find an active project past the first six or a finished one, so those take 3 taps or more. Search filters all projects, finished included, whenever the query is not empty; every active project shows by default, finished ones stay behind their link.
- **MCP:** none (`list_projects` exists).
- **Acceptance:** tests: a seventh active project and a finished project are found by name; 320px check; design review.

<a id="flow-411"></a>
### FLOW-411 · Project screen: lines on open, honest period label
- **Type:** SMALL UI · **Status:** ready · **Depends on:** FLOW-302
- **What:** From the 2026-10-07 tap-count review. Show a project's recent lines (the month list, capped) under its categories without the extra "תנועות אחרונות" tap; the band says the figure is since the project started; the "כל הקטגוריות" link that jumps to Settings goes. FLOW-402 keeps the full page with filters; FLOW-403 adds a period.
- **MCP:** none (`get_project` returns the lines).
- **Acceptance:** a project's lines are 2 taps from the Projects tab; the band names its period; empty and loading states; design review.

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
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
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
- [ ] After a failed read the role cache is looked up by user only, not company; the viewer can read the demo audit log.

<a id="flow-508"></a>
### FLOW-508 · Settings and connect sheet follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Token and key fields render RTL; add `dir="ltr"` (Mercury and SUMIT).
- [ ] An empty token goes to the server and comes back as a toast; add an inline client check with a reserved message line (both connectors).
- [ ] The busy refresh row shows no spinner; keep the token field read-only while connect is busy.
- [ ] A reloaded tab gets no message when a run fails; show the stored last error in the sheet.
- [ ] Refresh completion is announced only by the toast; add a status text update.
- [ ] Share one Settings block for Mercury and SUMIT; the Mercury status schema duplicates the DB type.
- [ ] Back off status polling on error; release only the run's own claim; consider a shorter claim expiry.
- [ ] Settings copy: the "עודכן" phrase should stay on one line at 320; the rate-limit copy without a retry time; the last-use date format; a dangling separator at 320.
- [ ] Onboarding header back control goes to sign-in and drops `preview=1`; the onboarding round trip leaves no-op Back steps.

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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] The cron path doesn't take the connector claim, so cron and manual runs can overlap; the Mercury cron path doesn't release its claim when it skips.
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
- **Type:** PLAN FIRST · **Status:** ready (plan answered 2026-10-08) · **Depends on:** —
- **What:** The proposed first phase: (1) make Jev run after syncs and learn from confirmations, and produce the shadow accuracy report on approved lines; (2) faster review (reasons, "approve all sure ones", income suggestions); (3) anomalies v1 in one list (SQL detects, Jev scores only candidates); (4) recurring patterns in SQL that feed missing bills and expected months. Also a review of other features where Jev can help. The numbers always come from SQL; Jev never approves ([0084](../decisions/0084-jev-auto-prefill.md)). A daily call cap per company in SQL and a usage log, since the provider has no spend cap.
- **Owner's answers (2026-10-08):** Jev runs after each bank sync, with a daily call cap per company; Jev's sure suggestions are reviewed one by one like every line, with no approve-all in the app (FLOW-324 dropped; MCP keeps `assign_expenses`); anomalies show as a flag on the review card, with no new screen; recurring patterns feed both missing-bill notices and expected future months.
- **Acceptance:** owner answers the plan's open questions, then one PR per item.

<a id="flow-702"></a>
### FLOW-702 · Jev auto mode
- **Type:** PLAN FIRST · **Status:** on-hold · **Depends on:** FLOW-701
- **What:** When the mode is `auto` and confidence is at or above the threshold, pre-fill the tag marked as AI and undoable in one tap; anomalies above a level always go to review; the toggle is the kill switch. Needs atomic allocation writes first. Show the threshold as a percent choice only in auto mode.
- **Acceptance:** threshold edge tests; undo restores; audit trail.

<a id="flow-703"></a>
### FLOW-703 · Jev corrections write-back
- **Type:** SMALL CYCLE · **Status:** on-hold (with FLOW-701) · **Depends on:** —
- **What:** Write the owner's corrections back as training signal; confirm on main that saving a change sheet seeded with a Jev guess never turns that guess into a supplier rule by default; make the split approve path atomic; expose a "no project / overhead" choice to the model; consider finished projects for lines dated before the finish.
- **Acceptance:** tests for the seeded change sheet and the correction write.

<a id="flow-704"></a>
### FLOW-704 · Jev review card follow-ups
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] If the flag read stalls past 1s while Jev is on, the card swaps back and writes the flag off; a flag that's off while Jev is on leaves one approvable read on the next launch; the 5-minute flag cache delays a server-side change; each next card waits about 0.8s again during a long stall.
- [ ] A Jev-filled card still shrinks about 30px when it settles; reserve the note height with the text hidden.
- [ ] When the Jev scope appears after mount, the card re-reads once; a queue-level test that the query key carries the scope; the scope binding is a side effect during render.
- [ ] A test that fails if the live-read wait is removed; a provider-level test for a user switch without sign-out; return `company_id` from `list_review` so a failed company lookup still uses the remembered flag.
- [ ] Delete the old shared connector key once per launch, not on every read.
- [ ] Jev Settings row: reserve the options slot only when the last known state was on; announce the switch state; mark the loading row busy; an open/closed chevron on אפשרויות; a "no key" status once a key-status RPC exists.
- [x] Jev tagging job: a cron with a DB run lease, persisted usage per run. (FLOW-701 part 1, decision [0124](../decisions/0124-jev-after-sync.md).)
- [x] The review card marks a project or category Jev filled with "✦ הצעת Jev" (the shared `JevTag`) instead of הצעה (2026-10-08, #141).
- [ ] שינוי שיוך and the statement row still show הצעה, or ✦ alone, on a Jev fill.

## Infra and CI

<a id="flow-801"></a>
### FLOW-801 · Backups and restore tests
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
- **What:** From the original plan: a nightly encrypted dump to off-site storage with failure alerts, a weekly storage sync, a monthly restore test (row counts and P&L checksums), and a quarterly drill runbook.
- **Acceptance:** plan approved (storage, keys, cost); seven nightly dumps; an alert fires on a forced failure.

<a id="flow-802"></a>
### FLOW-802 · Health check and usage monitoring
- **Type:** PLAN FIRST · **Status:** plan-first · **Depends on:** —
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
- **Type:** SMALL CYCLE · **Status:** ready · **Depends on:** — (best between feature PRs, it conflicts with everything)
- **What:** `app/src/screens/flow-screens.tsx` holds most screens in one file, so builders read too much and PRs conflict. Move each screen to its own file with no behaviour change.
- **Acceptance:** no snapshot or test changes besides imports; bundle size unchanged within noise.

<a id="flow-808"></a>
### FLOW-808 · Shared test fixtures and pitfalls upkeep
- **Type:** SMALL CYCLE · **Status:** ready · **Depends on:** —
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
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** —
- [ ] Migration checker: scan nested dollar-quoted bodies and commits inside DO or function bodies; don't flag `begin atomic`; flag unwrapped create/drop index.
- [ ] Record the production row-hash baseline query in a script, so a baseline can be recomputed after a deploy.
- [ ] If Dependabot is added, give it the fixture deny-list secret (CI fails closed without it).
- [ ] Optional: indexes for composite foreign keys without a matching index (advisor info).
- [ ] Smoke: a failure message on the sheet-stack scrim check; anchor the auth allowlist to the Supabase host; a unit test for the reporter.
- [ ] Add `supabase migration repair` to the CI/CD runbook.
- [ ] Consider per-PR changelog fragments; `docs/changelog.md` conflicts on almost every parallel PR.

<a id="flow-812"></a>
### FLOW-812 · Faster CI
- **Type:** SMALL CYCLE · **Status:** claimed (CI agent, 2026-10-07, claude/project-thread-uiob2d) · **Depends on:** —
- **What:** A PR waits about 11 minutes for CI because one runner does every storybook step after the unit tests, and the static-story smoke opens every story in one serial test (about 6 minutes). Run the storybook smoke and the main Playwright suite as shards on parallel runners behind the `check` and `e2e` gate jobs. Start local Supabase while dependencies install.
- **Acceptance:** Same tests run; the required check names stay `lint`, `check`, `e2e`; PR CI wall time drops by at least a third.

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
- **Type:** SMALL CYCLE · **Status:** ready · **Depends on:** —
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
