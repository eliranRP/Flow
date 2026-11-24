# FLOW-1275: forecast, loan and profit math in the database

The perf steward's plan for [FLOW-1275](../backlog/tasks/FLOW-1275.md), decision [0271](../decisions/0271-half-second-by-kept-data-and-one-wave.md) item 4. The owner approved the direction on 2026-11-24 ("Write the plan and implement it", to "FLOW-1275 moves the forecast and profit math from the phone to the server (summary reads)"). This file is the plan; builders take it slice by slice ([Slices](#6-slices)).

Rules it keeps: [0230](../decisions/0230-screens-data-in-half-a-second.md) (speed work never changes what a screen shows), the $5 cap of 0034 and the Supabase Free plan of [0037](../decisions/0037-supabase-pilot.md) (3 GB egress a month, a shared small database), money in minor units as `bigint`, the Israel day (`israelToday()` in the app, `private.flow_today()` in the database), RLS on every table a read touches, and new reads `security invoker`.

## Summary

- **The measured cost is the loan schedules, not the forecast arithmetic.** On Flow QA-shaped data (production counts, invented values, [method](#how-the-client-math-was-timed)), the company's next month takes 23 ms of plain Node time, and 0.8 ms of it is everything except the loans. For every project and month, `loanParts` and `loanCashOnly` each call `paymentsLeft` for every loan, and each call builds two whole schedules (the loan's own, then the rest of it from the balance in the books, `remainingFromBalance`), so the year view's rest of the year in January (11 months) takes 275 ms, and 12 forecast months take 286 to 309 ms. On the FLOW-804 phone (CPU 4× slower) that is roughly 0.1 s for next month and over 1 s for a January year view. The month forecast of Home and the Forecast screen (`buildMonthForecast`) takes 0.2 ms.
- **The bytes are the inputs.** Profit's next-month card downloads about 182 KB of inputs (production, Flow QA): `company_next_month_inputs` slim 66,264 B, `expected_months` 42,017 B, `list_categories` 47,638 B, the loans with their rates about 21 KB and `loan_balances` 5,233 B. The year view reads the full inputs, 126,699 B. A finished answer for the card is a few KB.
- **So the plan, in order:** (1) build each loan's schedule once per read on the phone, which takes most of the CPU cost away with no change to any figure and no server work; (2) shared JSON test vectors that run against the TypeScript builders and pgTAP, on their own; (3) the month forecast as one SQL read, then Home and the Forecast screen switch to it in a later PR; (4) the loan schedule in the database, kept in a summary table that triggers rebuild on every loan or rate write (it saves the first of the two builds; the rest of the schedule from the balance is still built on each read, in the database); (5) the company forecast as one SQL read for Profit, Home's future months and the company forecast pages; then the project page and the Loans list (each a database PR, then an app PR), flow-mcp, and a category-months summary table only if the server time asks for it.
- **What stays on the phone:** the profit page's model (`buildProfitModel` groups figures the server already summed: 2 to 7 ms in the profile), the recurring list (built in the database already; its 0.64 s production mean is [FLOW-1300](../backlog/tasks/FLOW-1300.md)), Review (no forecast or profit math), sorting and wording of rows.
- **Expected gain:** under 0.1 s of phone CPU on most screens after slice 1, and up to about 1 s on the year view early in the year; 4 to 5 requests and 40 to 180 KB less per forecast screen visit after the server slices. First visits (2.3 to 5.4 s) are mostly app start and request waves, so they come down by 0.1 to 0.4 s per screen, not to 0.5 s; FLOW-1269 and FLOW-1280 are the levers for those.

## 1. Today, measured

### Sources

- **Main thread:** the [2026-11-23 main-thread profile](../qa/perf/2026-11-23-main-thread.md) (FLOW-1274), first visit and kept-data visit, medians of 3, on the stub backend. Its stub answered `company_next_month_inputs`, `forecast_overrides_for` and the project reads with empty or tiny answers ([FLOW-1284](../backlog/tasks/FLOW-1284.md)), so **the forecast, next-month and profit math was not measured there**.
- **The forecast math at production size:** this plan's own timing of the real builders in Node on invented data with Flow QA's production counts ([method](#how-the-client-math-was-timed)). These are Node times on the cloud agent without the 4× slow-down; the phone figures in this plan are those times × 4, an estimate until FLOW-1284 profiles them on the phone.
- **Sizes and database times:** production, as Flow QA's owner, read-only, 2026-11-24 about 03:40 to 04:00 UTC (pattern under [How the database was measured](#how-the-database-was-measured)). Sizes are the JSON text of the answer; the [2026-11-24 report](../qa/perf/2026-11-24.md) gives the HTTP bodies (for example `company_next_month_inputs` full 126,699 B in both).

Flow QA's shape (counts only): 14 active projects, 382 project category rows over a 6-month window, 38 general rows, 108 recurring parties (`expected_months` 0), 22 open loans (12 amortizing of 360 months, 4 balloon of 60, 5 interest-only of 12 to 360, 1 demand; 16 rate rows), 134 categories, 29 next-month edits, 184 edits over the 12 forecast months, 1,867 transactions and 4,022 legs.

### Per screen

| Screen | Client math (where) | Main thread today | Inputs it downloads (production, Flow QA) |
| --- | --- | --- | --- |
| Home, this month's forecast row | `buildMonthForecast` (`packages/shared/src/month-forecast.ts`, through `month-forecast-query.ts`) | 0.2 ms Node; not in the profile (cold Home's profile ends before the row, which reads after first paint, FLOW-1019) | `expected_months(0)` 42,017 B; `company_forecast_edits_for` 8,124 B; `forecast_overrides_for` (none for Flow QA); `list_unpaid` (Home's own read); the company currency. 5 reads |
| Home, a future month (`?month=`) and its company next-month page | `companyMonthForecast` → `companyNextMonthForecast` with the loans (`company-year-forecast.ts`, `company-next-month.ts`, `project-next-month.ts`, `project-next-loans.ts`) | 23 ms Node (about 90 ms on the phone); 0.8 ms of it without the loans | slim `company_next_month_inputs` 66,264 B, or the full 126,699 B for a month after next; `expected_months` 42,017 B; loans and rates about 21 KB; `loan_balances` 5,233 B; `list_categories` 47,638 B (shared) |
| Project page | `nextMonthForecast` + `applyForecastEdits` + `cashForecast` for one project, with its loans (`next-month-for-project.ts`, `project-next-month.ts`) | Profile: "our code outside React" 88 ms first visit, `useNextMonthForecast` 4 ms and `useProjectNextMonth` 3 ms on the stub's small answers; not measured at size | `expected_months(0, project)`, `project_category_months`, `project_forecast_edits_for`, `forecast_overrides_for`, the loans in `get_project` (FLOW-1240), `list_categories`; FLOW-1233 counts eight reads in the second wave |
| Profit, month (next-month card) | `companyNextMonthForecast` (`company-next-month-query.ts`) | Profile 61 ms "our code" with an empty inputs answer; at size 23 ms Node (about 90 ms on the phone) | 4 reads, about 182 KB: slim inputs 66,264 B, `expected_months` 42,017 B, loans about 21 KB + `loan_balances` 5,233 B, `list_categories` 47,638 B |
| Profit, year | the card plus `companyRestOfYear` (one build per month left in the year) | Profile 24 ms on the stub; at size 23 ms Node in November (one month left), **275 ms Node in January** (11 months; about 1.1 s on the phone) | full inputs 126,699 B instead of the slim, the rest as above |
| Profit, by date | as the month view, plus `buildProfitModel` over the lines | Profile 116 ms "our code"; the card's math as above | as the month view, plus the lines |
| Forecast (`/forecast`) | `buildMonthForecast` (the same query as Home's row) | 0.2 ms Node; profile "our code" 78 ms (kept data and the chart, not the builder) | the same 5 reads as Home's row |
| Loans | `buildLoanSchedule`, `paymentsLeft`, `loanOutlook`, `latePayment` per loan (`screens/loan-outlook.ts`) | Profile: about 21 ms of schedule math with 12 invented loans; at size 11.5 ms Node for Flow QA's 22 (about 45 ms on the phone) | `loans` with rates about 21 KB, `loan_balances` 5,233 B, `loan_unsplit_payments`, projects' names |
| Recurring | none: `recurring_schedule` builds the list in the database; the app maps rows (`toRow` 3 ms) | profile 20 ms "our code" | `recurring_schedule` 57,412 B (HTTP), 133 ms in the database warm, 665 ms mean in production since 11-21 (FLOW-1300) |
| Review | none | profile 89 ms "our code" (kept data, queue) | n/a |

### The database side today

Every read aggregates the ledger on each call; there is no summary table. Warm, as Flow QA, mean of 5 after one warm-up:

| Read or part | ms | Note |
| --- | ---: | --- |
| `company_next_month_inputs` full / slim | 131.8 / 111.5 | the daily report: 125 to 145 |
| of which `private.project_category_months_lean`, all 14 projects | 59.9 | the project category months |
| the same, the largest project alone | 24.3 (46.9 in one `EXPLAIN ANALYZE` with its plan and first call) | the cost of recomputing one project |
| `expected_months(0)` | 95.7 | built on `private.recurring_parties` |
| `recurring_schedule` / `missing_bills` | 133.3 / 113.0 | the same core; FLOW-1300 |
| `company_forecast_edits_for` | 3.1 | |
| `list_unpaid` | 10.7 | Flow QA has none open |
| loans with rates (table reads) / `loan_balances` | 2.2 / 3.1 | |
| `get_profit_months` | 23.5 | |

Production's `pg_stat_statements` since 2026-11-21 05:58 UTC (70 hours, `track = top`): 69,621 calls and 5,479 s of execution in all, about 2.2% of one core on average. The forecast inputs are a large part of it: `expected_months` 593 calls at a 527 ms mean (312 s), `company_next_month_inputs` 179 calls at 600 ms (107 s), `company_forecast_edits_for` 467 calls at 134 ms. The means are 4 to 6 times the warm times above, the FLOW-1300 gap.

Three of the inputs' tables are not readable by `authenticated` at all (`project_forecast_edits`, `recurring_overrides`, `forecast_line_matches`: no grant, RLS on, no policy); today's reads reach them through `security definer` functions. A `security invoker` read must either call those definer reads or get a select policy and grant on the tables (each slice says which).

## 2. What moves

One choice per computation. "Function" is a SQL function returning the finished figures; "summary table" is a table kept current by triggers; a materialized view was considered for each and rejected (below).

| Computation | Today | Choice | Why |
| --- | --- | --- | --- |
| Loan schedule on the loan's own terms (`buildLoanSchedule`, `scheduleRowsOf`) | phone, every read, per loan, project and month | **Summary table** `public.loan_schedule_rows`, rebuilt per loan by triggers on `loans` and `loan_rates` (slice FLOW-1306); a pure `private.loan_schedule(jsonb)` builds it | Depends only on the loan's terms and rates, which change rarely (0 writes to `loans` and `loan_rates` in production since 11-21), and is read on every forecast and Loans read. Building it in plpgsql costs about 1.6 ms a loan (a 360-step exact power and 360 rows, measured as Flow QA), so a write pays that once and every read pays an index scan. It saves the first of the two builds that `paymentsLeft` makes (below) |
| Payments left, outlook, late check (`paymentsLeft` with `remainingFromBalance`, `loanOutlook`, `latePayment`) | phone | **Function** `public.loan_outlooks(p_today)` over the summary table and `loan_balances` (slices FLOW-1310, FLOW-1316); `company_forecast` uses the same rule | The rest of the schedule is built again from the balance in the books, from the first payment due on or after today. That depends on the ledger legs and on today, so it cannot be stored without a trigger on every loan leg and a rebuild when a due date passes. Built on each read in plpgsql, it costs about 1.6 ms a loan, about 35 ms for Flow QA's 22 loans per read; the late check reads the stored rows alone. Storing it (keyed by loan, balance and first period, rebuilt by a trigger on loan legs and filled lazily for a new period) is left for a later task if the reads' time asks for it |
| The month forecast (`buildMonthForecast`) | phone and flow-mcp, from 5 reads | **Function** `public.month_forecast(p_month text, p_today date default null)` (slices FLOW-1313, FLOW-1314) | 0.2 ms of math; the win is one request and fewer bytes. Its inputs depend on today (seen this month, due this month), so a stored copy would go stale at midnight |
| A project's month (`nextMonthForecast`, `applyForecastEdits`, `cashForecast`) and the company's months (`companyNextMonthForecast`, `companyGeneralForecast`, `companyRestOfYear`, `companyMonthForecast`) | phone, from 4 to 8 reads | **Function** `public.company_forecast(p_months, p_detail, p_today)` (FLOW-1307, then FLOW-1308) and `public.project_forecast(p_project, p_month, p_today)` (FLOW-1309, then FLOW-1315) | Averages read the six complete months before today's month and the recurring due rule reads today, so the answer is a function of today; the parts that are costly to aggregate (category months) can come from a summary table later without changing the function's answer |
| Category months (`private.project_category_months_lean`) | database, every call (60 ms for Flow QA's 14 projects) | **Stays a per-call aggregate first; summary table** `public.category_month_sums` **only if** FLOW-1307's measured server time needs it (FLOW-1311) | It is half of the inputs' time, but a trigger on every ledger write is the riskiest piece of this plan ([section 3](#3-current-on-write)). Measure first |
| Recurring parties (`private.recurring_parties`, `expected_months`) | database, every call (96 ms) | **Stays** a per-call read | It is detection over the ledger with today in it; FLOW-1300 investigates its production time first |
| Profit model (`buildProfitModel`) | phone, 2 to 7 ms | **Stays on the phone** | It groups totals the database already summed (`get_dashboard`, `get_breakdown`) |
| Recurring list, Review | database / none | **Stay** | Nothing to move |
| Row order and wording (`localeCompare(..., "he")`, notes such as "6 שכירויות") | phone | **Stay on the phone** | No figure depends on order; Postgres collation and ICU in the browser can sort Hebrew differently, so the database returns rows and the app sorts and words them as today |

**Materialized views, rejected for every row:** `REFRESH MATERIALIZED VIEW` rebuilds all companies at once, needs the owner's privilege (a definer call from each write path) and, for `CONCURRENTLY`, a unique index; a refresh on every write would cost the whole aggregate (60 ms and growing for one company's category months) where a keyed rebuild costs one loan or one project.

### Hard requirements, and how each slice meets them

- **One definition, shared test vectors.** Each moved builder gets a pure core in both languages that takes the same JSON input: the app's builder (`packages/shared` or `app/src`) and a SQL function `private.<name>_build(p_input jsonb) returns jsonb`, `immutable`, with no table read. The public read is a thin `security invoker` wrapper that gathers the inputs (the same reads as today, so their existing pgTAP tests cover the gathering) and calls the core. The vectors are JSON files in `packages/shared/fixtures/vectors/<builder>/*.json`, each `{ "name", "input", "expected" }`. A vitest file runs every vector through the TypeScript core. A script, `scripts/vectors-sql.mjs`, writes `supabase/tests/database/vectors_<builder>.test.sql` from the same files (one `is(private.<name>_build(input), expected)` per vector); `--check` fails when the generated file is out of date, and the gate runs it beside `backlog-index`. The first vectors are the existing unit tests' cases (`loan-schedule.test.ts`, `month-forecast.test.ts`, `project-next-month.test.ts`, `company-next-month.test.ts`, `company-year-forecast.test.ts`), exported once by a script and then kept as data.
- **Money.** Inputs and outputs carry amounts as JSON integers of minor units, as every read does today (`agorotSchema` turns them into `bigint`); SQL computes in `bigint`, and `numeric` only where TypeScript uses an exact rational (the annuity's power). Each vector set has a case near 2^53 and the pgTAP file asserts every output amount is an integer.
- **Israel time.** Every new read takes `p_today date default null`, the Israel day passed by the app (`israelToday()`), falling back to `private.flow_today()` (`now() at time zone 'Asia/Jerusalem'`), as `expected_months` and `company_next_month_inputs` already do; it passes the same day to every read it gathers. No function reads `current_date` or a UTC `now()`.
- **RLS and security invoker.** Every new public function is `security invoker`, `stable`, `set search_path = ''`, granted to `authenticated` only; every new table has RLS on with a select policy `company_id = (select private.readable_company_id())` (the policy every ledger table uses) and no write grant to `authenticated` (only the triggers' definer functions write it). Where a wrapper needs a table `authenticated` cannot read, it calls the existing definer read instead of widening the grant; each of those (`expected_months`, `company_forecast_edits_for`, `project_forecast_edits_for`, `company_next_month_inputs`) still scopes itself to `readable_company_id`, so this widens nothing. The pure cores `private.*_build` and `private.loan_schedule` are granted `execute` to `authenticated` (and `service_role`), since the invoker wrappers call them as the user; they read no table, so the grant exposes no data. A pgTAP case per read checks that another company's member gets nothing.

## 3. Current on write

Only two summary tables are planned, and the second only if measured to be needed.

### `public.loan_schedule_rows` (FLOW-1306)

Columns: `company_id`, `loan_id`, `period`, `due_date`, `interest_minor`, `escrow_minor`, `principal_minor`, `payment_minor`, `balance_minor`, plus one row per loan in `public.loan_schedule_meta` (`loan_id`, `balloon`, `final_adjustment`, `error` for terms the schedule refuses, `terms_hash`). Primary key `(loan_id, period)`; index `(company_id, loan_id, due_date)`. Both tables have `loan_id references public.loans(id) on delete cascade`, so deleting a loan, or a company with its loans, removes their rows with no trigger.

| Write path | Trigger | Stale window |
| --- | --- | --- |
| `loans` insert, or update of any term column (`principal_minor`, `annual_rate_ppm`, `term_months`, `start_date`, `payment_minor`, `escrow_minor`, `kind`, `interest_only_months`, `amortization_months`, `status`) | `after ... for each row when (old.* is distinct from new.*` on those columns`)`: rebuild that loan (delete its rows, insert `private.loan_schedule(terms)`) | none: the same transaction |
| `loans` delete | no trigger: the foreign keys cascade | none |
| `loan_rates` insert, update, delete | `after ... for each row`: rebuild the rate's loan; on a delete only if the loan still exists (a loan's delete cascades to its rates, and then to its rows) | none |
| `create_loan`, `mcp_add_loan`, `mcp_update_loan`, `delete_loan`, `delete_loan_rate`, refinance, close | write through the two tables above | none |
| Ledger legs, loan splits, payments | **no trigger**: the balance is not stored; `loan_outlooks` and `company_forecast` read `loan_balances` (a `security_invoker` view over the legs) and build the rest of the schedule from it on each read (about 1.6 ms a loan, [section 2](#2-what-moves)) | none |
| A change to the schedule code itself | the migration that changes `private.loan_schedule` rebuilds every loan's rows in the same migration (`terms_hash` also lets a check find rows built by older code) | none |

Write cost: about 1.6 ms per loan rebuilt (measured as Flow QA: 22 loans' 360-step exact power and 360 interest rows in 35.5 ms, read-only, in plpgsql); a rate change on one loan rebuilds one loan. Production wrote neither table since 11-21. The creating migration backfills every company's loans (33 rows in `loans` in all), well under a second.

### `public.category_month_sums` (FLOW-1311, only if needed)

Columns: `company_id`, `project_id`, `category_id` (null for uncategorized), `currency`, `month`, `amount_minor`: what `private.project_category_months_lean` sums today for a project's expense lines that count in the profit, before the average. Storing only the closed months would not be enough (a backdated line changes a closed month), so it holds every month and the read picks the window from `p_today`; no midnight or month-end job.

**Where the list comes from.** The trigger list is derived, not remembered, tables and columns both:
- **Tables.** Every relation `private.pnl_lines` depends on (`pg_depend` through its rewrite rule) and every relation `private.project_category_months_lean` and the functions it calls read, with each view resolved recursively to its base tables. `private.pnl_lines`, `private.split_parts` and `private.loan_parts` are views (`split_parts` and `loan_parts` are views over `public.legs`, `20261028093217_ledger_only.sql`, decision 0232), so they get no trigger of their own: the `legs` trigger covers them. On production today `pnl_lines` resolves to `public.accounts`, `public.allocations`, `public.categories`, `public.companies`, `public.legs` and `public.transactions`; the lean function adds `public.review_queue`.
- **Columns.** A view's rewrite rule records the columns it reads in `pg_depend.refobjsubid`; the lean function's body names the rest. Today's list includes, besides the obvious ones: `transactions.removed_at`, `line_status` (`pnl_lines` keeps `removed_at is null and line_status = 'posted'`), `pnl_role`, `direction` and `currency` (the line's role, project or shared, comes from `pnl_role`, `direction` and the company's overhead project; the lean read keeps `pnl_role = 'project'`), `companies.overhead_project_id`, and `categories.kind` (`coalesce(c.kind, t.direction)` decides an expense).
- **The test.** FLOW-1311 adds a pgTAP test that computes those base tables and columns (from `pg_depend`, resolving views, plus a fixed list for the function body that the test itself checks against the body's text) and fails when a table has no sums trigger or a referenced column is missing from its trigger's `update of` list. A new dependency, table or column, cannot be missed.

What changes a row, and the trigger (the columns below are today's; the test is the source of truth):

| Write path | Why it changes a sum | Trigger |
| --- | --- | --- |
| `legs` insert, update, delete (sync, manual entry, splits, journals; `journal_entry_update` moves legs with `update public.legs set transaction_id = ...`). This covers the views `private.split_parts` (a split's part) and `private.loan_parts` (a loan payment's parts, which decide `in_pnl_override`) | the line itself, the transaction it belongs to, a split part's project or a loan part | statement-level `after` with transition tables (old and new rows on an update), collecting `(company, project, month)` keys from both sides, for the line's project, for a split part's own project (the leg's `project_id` with `project_explicit`) and, for a shared line, every project in its `public.allocations` (the lean read sums a shared line under each allocated project, not the line's own `project_id`) |
| `transactions` insert, delete, and update of `project_id`, `doc_date`, `in_pnl_override`, `category_suggested`, `removed_at`, `line_status`, `pnl_role`, `direction`, `currency` and the amount columns | which project, month or currency, whether it is posted or removed, whether it is a project or a shared line, and whether it counts | the same keys as `legs`, on both the old and the new side of an update: the line's project, its split parts' projects and, for a shared line, every project in its allocations (so a `pnl_role` change from project to shared takes the old project and the new allocated ones, and back). `update of` limited to those columns (not `category_id`: the category comes from the leg): production has 5,172 transaction updates in 70 hours (about 74 an hour), mostly sync touches that change none of them |
| `allocations` insert, update, delete | a shared line's share of a project | the same |
| `review_queue` insert, delete, and update of `status` | the lean read hides a line while an open row exists for it | the same |
| `categories` update of `excluded_from_pnl`, `loan_part`, `kind` | whether the category counts, and whether its lines are expenses | rebuild the company's rows for that category |
| `accounts` update of the account's type; `companies` update of the base currency or `overhead_project_id` | which lines `pnl_lines` counts, the base currency's order, and which lines are overhead rather than a project's | rebuild the company |
| **A migration or backfill that bypasses triggers** (`alter table ... disable trigger`, as `20261003200000_connector_l1a_filed_today.sql` did on `transactions`, or `session_replication_role = replica`, which the tests use) | the sums go stale with no trigger firing | such a migration must end by rebuilding the sums of the companies it touched (`private.category_month_sums_rebuild(company)`); the migration checklist in CONTRIBUTING gets that line in FLOW-1311, and the read-only parity check in the daily report catches one that forgets |

The collected keys are rebuilt once per transaction by a deferred constraint trigger (`deferrable initially deferred`), so a sync that writes 200 lines of 3 projects rebuilds 3 projects once at commit, not 200 times. No stale window: the rebuild commits with the write. Measured cost of one project's rebuild today: 24.3 ms warm, 46.9 ms with planning and a first call (the largest project, read-only `EXPLAIN ANALYZE` as Flow QA). Legs saw 176 inserts and 172 deletes in 70 hours.

The risk is that the sum's rules live in several places (`private.pnl_lines`, `private.line_in_pnl`, the review and suggestion checks). FLOW-1311 adds a pgTAP parity check, the table's rows equal `private.project_category_months_lean`'s for every project of the test fixtures after each kind of write above, and a daily-report check that compares the two for Flow QA, read-only. If the forecast function's server time is within the budget without it (FLOW-1307's acceptance), FLOW-1311 is closed unbuilt.

### Everything else is computed at read time

Recurring overrides, forecast overrides (skips), project forecast edits and line matches are read inside the function on every call, so a write to them is seen by the next read with no trigger.

## 4. Release order and compatibility

1. **Add, never replace.** Each slice adds its new function or table in its own migration. No slice drops or changes the answer of a read an older app version or flow-mcp uses: `company_next_month_inputs` (flow-mcp's `get_company_next_month_inputs` returns it as is), `expected_months`, `forecast_overrides_for`, `company_forecast_edits_for`, `project_forecast_edits_for`, `project_category_months` (flow-mcp's `get_category_months`), `list_unpaid`, `list_categories`, `loans`, `loan_rates`, `loan_balances`, `recurring_schedule`. The PWA keeps older builds on phones until they update, and they call these reads.
2. **Database first, app second, always two PRs.** Every new read ships in a database PR (migration, pgTAP, vectors, no app change), and the screens switch in a separate app PR: FLOW-1313 then FLOW-1314 (month forecast), FLOW-1307 then FLOW-1308 (company forecast), FLOW-1309 then FLOW-1315 (project forecast), FLOW-1310 then FLOW-1316 (loan outlooks). The app PR is claimed only after the database PR's deploy run has applied its migration on production, checked read-only (`select to_regprocedure('public.<name>(...)') is not null`). So the new app is never served before its read exists; if a read is missing anyway (a rolled-back migration), the screen shows its usual failed-read state with retry, as for any failed read, and the database PR's revert does not need the app's. The app's PR removes the client code it replaces (CONTRIBUTING: remove what your change leaves unused), but the old database reads stay.
3. **Kept data.** Each switch adds its new key to `app/src/kept-rules.ts` and removes the old keys the screen no longer reads; a kept entry under an old key is simply not used.
4. **flow-mcp** moves last (FLOW-1312): `get_forecast` calls `month_forecast` instead of building from four reads, and a new `get_company_forecast` tool is added. The old tools stay, so an assistant's saved instructions keep working.
5. **Stories and the preview.** `?preview=1`, the dev samples (`app/src/dev/`) and the stories build their figures with the TypeScript builders from invented inputs. The builders therefore stay as the reference implementation, and the vectors keep the two in step. Deleting a TypeScript builder is a later decision, only once no sample, story or test needs it.
6. **Dropping an old read** is not in this plan. A later task may drop one after flow-mcp and the app have stopped calling it for 30 days (`pg_stat_statements` shows no call).

## 5. Gain per screen

Phone CPU is the Node time × 4 (an estimate, see Sources). Bytes are production's JSON sizes for Flow QA. "Server" is the database time per call, warm.

| Screen | Phone CPU saved | Requests and bytes | Server per call | Settle and first visit |
| --- | --- | --- | --- | --- |
| Profit, month (card) | FLOW-1304: about 40 ms (23 → about 13 ms Node: each loan's two builds once per read, about 12 ms, plus 0.8 ms); the server slices: the rest, about 50 ms | 4 reads (about 182 KB, of which `list_categories` 48 KB is shared with other screens) → 1 read of about 2 to 5 KB with `p_detail = 'totals'` (FLOW-1307, FLOW-1308) | today about 230 ms over 4 reads (inputs 112, expected 96, loans 5, categories 16); after: one call of about 270 to 300 ms (the same inputs gathered inside, plus about 35 ms to build the loans' rest of schedule from their balances and the assembly), about 215 to 245 ms with FLOW-1311 | the card's settle on a first visit is about 0.2 to 0.4 s earlier (about 180 KB less on a 9 Mbps line is about 0.15 s, 3 fewer requests share the line, and the CPU above); the first visit's 2.6 s median is mostly app start |
| Profit, year | in January to March up to about 1 s (275 → about 20 ms Node for 11 months) after FLOW-1304; in November about 40 ms; the rest with the server slices | full inputs 126,699 B → one answer of totals per month, about 1 to 2 KB | as the month card, once for all months | the year card settles about 0.3 to 1.2 s earlier on a first visit early in the year |
| Home, future month and company next-month page | about 90 ms per month shown | 4 to 5 reads (about 135 to 195 KB) → 1 | as Profit | about 0.2 to 0.4 s |
| Home, this month's row; Forecast screen | none (0.2 ms) | 5 reads (about 50 KB and Home's unpaid) → 1 of about 42 KB uncompressed (measured by FLOW-1313 on a local fixture of 118 items: 53 charges, 40 open invoices, 25 added lines; each item without currency, expected_on, late_days and null fields; the three large inputs it replaces are about 44 KB there, so the saving is the four requests, and a `totals` mode for Home's row can come later) (FLOW-1313, FLOW-1314) | about 110 ms in one call instead of 5 | the row and the Forecast screen wait for one request instead of five on the same line; Forecast's first visit (2.95 s median) about 0.1 to 0.3 s earlier |
| Project page | about 20 to 40 ms (one project's loans and months; estimated from the company build) | 6 to 8 second-wave reads → 1 (FLOW-1309, FLOW-1315; replaces FLOW-1233's inputs read) | about 100 to 160 ms (the project's loans' rest of schedule included) | the forecast card's second wave, 1.3 s in FLOW-1230's trace, becomes one round trip: about 0.5 to 1 s earlier on a first visit |
| Loans | about 45 ms (11.5 ms Node for 22 loans) | `loans` with rates about 21 KB + `loan_balances` 5 KB → `loan_outlooks` about 4 to 6 KB (measured by FLOW-1310 locally: 6.0 KB for 22 loans) (FLOW-1310, FLOW-1316) | about 40 ms (about 35 ms of it the rest of each loan's schedule from its balance, the rest index reads; measured by FLOW-1310 locally: about 34 ms a call for 22 loans of Flow QA's kinds with 11 rate rows) | small; Loans' 5.4 s first visit is its 3 waves (FLOW-1298) and app start |
| Recurring, Review | none | none | none | none (FLOW-1300 for Recurring's server time) |

**Against the Free plan:**
- **Database CPU.** The new reads gather the same inputs inside one call, so their time is about the sum of today's reads plus the loan math that moves off the phone (about 35 ms a call for Flow QA's 22 loans): roughly 15% more database time per forecast read, which the Free plan's load (below) absorbs, and less with FLOW-1311. Today's whole load is about 2.2% of one core (70 hours of `pg_stat_statements`). The summary-table triggers add about 1.6 ms per loan write and, with FLOW-1311, 25 to 47 ms per project per write transaction that touches it. Each slice measures its read's mean in production after a day and reports it in the daily report.
- **Egress.** Each forecast screen visit sends 40 to 180 KB less; this helps FLOW-1269's background reads, which decision 0271 estimates at 111 KB per session against 3 GB a month.
- **Concurrency.** One call holds a connection for 0.2 s instead of four calls for 0.1 s each; with FLOW-1300's finding on concurrent calls in mind, each slice checks the production mean and max after a day.

## 6. Slices

Ordered. Each is one PR; a new read and the app's switch to it are always two ([section 4](#4-release-order-and-compatibility)). Ids are free on main and in the open PRs (checked again 2026-11-24 after review r3: the only other open PRs, #1192 and #1262, name none of them).

### FLOW-1304 · The forecast builds each loan's payments left once per read (ready)

The biggest measured cost, with no change to any figure and no server work. In `app/src/project-next-loans.ts`, `dueRows` calls `paymentsLeft` for every loan of the part, twice per project and month (once from `loanParts`, once from `loanCashOnly`), and each call builds two schedules: the loan's own (`scheduleRowsOf`) and the rest of it from the balance (`remainingFromBalance`). Keep each loan's payments left in a per-read `Map` keyed by `loan.id`, `balanceMinor` and `today`, not by the loan object: `companyGeneralForecast` (`app/src/company-next-month.ts`) copies the general and overhead loans on every month's build (`{ ...loan, projectId: GENERAL }`), so a `WeakMap` on the object would miss them. The map lives for one build of the forecast (one call of `companyNextMonthForecast`, `companyRestOfYear` or `companyMonthForecast`), passed down or created by the caller, so it never outlives the read's data. A null result (no payments left: a demand loan, refused terms, a zero balance, no payment due on or after today) is stored too and found with `Map.has`, so such a loan is not rebuilt every month.
- **Files:** `app/src/project-next-loans.ts`, `app/src/project-next-month.ts` and `app/src/company-next-month.ts` / `company-year-forecast.ts` if the map is passed down from them, `app/src/project-next-month-loans.test.ts` or a new `project-next-loans.test.ts`.
- **Tests:** the same rows and totals for every existing forecast test; a spy shows one `paymentsLeft` computation per loan per read for a 12-month build, general and overhead loans included: at most two `buildLoanSchedule` calls per loan, two for each open loan with payments left (a demand loan makes none; refused terms, a zero balance or no payment left make one).
- **Acceptance:** `companyRestOfYear` for 11 months with 22 loans of Flow QA's kinds takes under 30 ms in Node (275 ms today) and the next month under 15 ms (23 today), on the method below; no figure changes.
- **Measure:** this plan's Node method, before and after; then FLOW-1284's phone profile.
- **Not in:** the Loans list (`loan-outlook.ts`, FLOW-1283's files).

### FLOW-1305 · Shared test vectors (ready)

The tooling alone, so the later database slices start from it.
- **Files:** `packages/shared/fixtures/vectors/README.md` (the format), `packages/shared/fixtures/vectors/month-forecast/*.json` (from `month-forecast.test.ts`'s cases, plus a split party, a handover, an ended charge, a quarter charge in and out of its month, an edit of each kind, an amount near 2^53) and `packages/shared/fixtures/vectors/loan-schedule/*.json` (every case of `loan-schedule.test.ts`, refused terms included); `packages/shared/src/vectors.test.ts` (runs each through the TypeScript builder); `scripts/vectors-sql.mjs` (writes `supabase/tests/database/vectors_<builder>.test.sql`, skipping a builder whose SQL core does not exist yet) and its test; the gate entry for `--check`.
- **Acceptance:** every vector passes in vitest; `--check` fails on a stale generated file; no SQL yet.

### FLOW-1313 · The month forecast in the database (blocked: FLOW-1305)

- **SQL:** `private.month_forecast_build(p_input jsonb)` (immutable; the `ForecastBuild` with items, income, expense, moved, small, totals, changed; `execute` granted to `authenticated`) and `public.month_forecast(p_month text, p_today date default null)` (security invoker; `p_today` goes to `expected_months(0, null, p_today)`, the only read it gathers that takes a date (null is `private.flow_today()`, which `expected_months` applies itself: `authenticated` cannot execute it); `list_unpaid()`, `forecast_overrides_for(p_month)`, `company_forecast_edits_for(p_month)` and the company currency take no date, and all are existing reads; the answer is `{ month, base, overrides, build }`). Migration `<ts>_flow_1313_month_forecast.sql`; pgTAP `flow_1313_month_forecast.test.sql` (equals the TypeScript build of the same company's reads in the fixtures; another company sees nothing) and the generated `vectors_month_forecast.test.sql`.
- **App:** none.
- **Acceptance:** every vector equal; the read's size and database time as Flow QA, read-only.

### FLOW-1314 · Home's forecast row and the Forecast screen read the month forecast (blocked: FLOW-1313)

Claimed once FLOW-1313's migration is on production ([section 4](#4-release-order-and-compatibility)).
- **App:** `app/src/month-forecast-query.ts` reads `month_forecast` with `israelToday()` (Home's row and the Forecast screen share it, as today); `month-forecast-build.ts` and its chunk go if nothing else loads them; `kept-rules.ts` keeps the new answer.
- **Acceptance:** Home's row and the Forecast screen show the same figures and rows (the e2e and story checks); 1 request instead of 5 for the forecast.
- **Measure:** the sweep (FLOW-1276) for Forecast and cold Home, before and after; `pnpm latency` for the new read.

### FLOW-1306 · The loan schedule in the database (blocked: FLOW-1305)

It stores the schedule on the loan's own terms: the first of the two builds `paymentsLeft` makes. The rest of the schedule from the balance stays a per-read build in the reads that need it (FLOW-1307, FLOW-1310), about 1.6 ms a loan.
- **SQL:** `private.loan_schedule(p_terms jsonb) returns jsonb` (immutable; every kind, rate changes and recasts, balloon and final adjustment, exact annuity in `numeric`, half-even interest with `private.div_half_even`; `execute` granted to `authenticated`); `public.loan_schedule_rows`, `public.loan_schedule_meta` (foreign keys to `loans` with `on delete cascade`), their RLS, the triggers of [section 3](#publicloan_schedule_rows-flow-1306) and the backfill. Migration `<ts>_flow_1306_loan_schedule.sql`.
- **Vectors:** FLOW-1305's `loan-schedule` vectors, now also through the generated pgTAP file; a trigger test per write path (a rate added, changed, deleted; a term changed; a loan closed; a loan deleted, which cascades).
- **App:** none.
- **Acceptance:** every vector equal, row for row; a write to `loans` or `loan_rates` leaves the table equal to `private.loan_schedule` of the new terms in the same transaction.
- **Measure:** the trigger's time per loan on a local database and, read-only, the function's time per loan as Flow QA on production.

### FLOW-1307 · The company forecast in one read (blocked: FLOW-1305, FLOW-1306)

- **SQL:** `private.company_forecast_build(p_input jsonb)` (the port of `nextMonthForecast`, `applyForecastEdits`, `skipEdits`, `companyNextMonthForecast`, `companyGeneralForecast`, `monthEdits`, `cashForecast`; averages with `roundDiv`, half away from zero; loan parts from the stored schedule's first payment due on or after today and the rest of the schedule built from `loan_balances` with the `remainingFromBalance` rule, once per loan per call, about 1.6 ms a loan; `execute` granted to `authenticated`), and `public.company_forecast(p_months text[], p_detail text, p_today date default null)`: for each month, the totals; with `'rows'`, each part's rows, removed, skipped and arrived rows, the loan cash and the split keys; with `'totals'`, the totals and the counts the cards' notes read (rent and other income streams). It gathers `company_next_month_inputs` (full only when a month after next is asked), `expected_months(0)`, the loans and `list_categories` inside.
- **Vectors:** from `project-next-month.test.ts`, `project-next-month-loans.test.ts`, `company-next-month*.test.ts`, `company-year-forecast.test.ts`, plus time-zone and month-length cases ([section 7](#7-risks)).
- **App:** none.
- **Acceptance:** equal to the TypeScript build for every vector and for the fixtures' companies; the read's mean time, warm, under 300 ms for Flow QA's size (estimated 270 to 300 ms: today's inputs about 230 ms, plus about 35 ms of loans and the assembly; else FLOW-1311 is built).
- **Measure:** its database time and size as Flow QA, read-only; `pnpm latency`.

### FLOW-1308 · Profit, Home's future months and the company forecast pages read the company forecast (blocked: FLOW-1307)

Claimed once FLOW-1307's migration is on production.
- **Files:** `app/src/company-next-month-query.ts` (one read per view: the card with `'totals'`, the year view with every month left, a month's page with `'rows'`), `app/src/screens/company-profit-screen.tsx`, `company-cash-next-month.tsx`, `home-future-month.tsx`, `company-next-month-screen.tsx` as needed, `kept-rules.ts`, their tests and stories. Remove the client paths the screens stop using.
- **Acceptance:** the same figures, rows and notes on every view (tests and stories); the card's reads go from 4 to 1; FLOW-1294's card shows from kept data as before.
- **Measure:** the sweep for Profit month and year and a Home future month, three times each, before and after; bytes per visit.

### FLOW-1309 · The project forecast in the database (blocked: FLOW-1307)

`public.project_forecast(p_project uuid, p_month text, p_today date default null)`, the one-project form of FLOW-1307's core with the project's own category months (`project_category_months`) and edits, in profit and cash terms, the project's loans' rest of schedule built per read. It replaces FLOW-1233's planned inputs read (that task's second wave becomes this one read); FLOW-1233 is closed in favour of it when this slice is claimed.
- **Files:** a migration, pgTAP and vectors. No app change.
- **Acceptance:** equal to the TypeScript build for every vector and the fixtures' projects; size and database time reported.

### FLOW-1315 · The project page reads the project forecast (blocked: FLOW-1309)

Claimed once FLOW-1309's migration is on production.
- **Files:** `app/src/project-next-month-query.ts`, `app/src/next-month-for-project.ts`, the project's next-month and edit screens' reads, `kept-rules.ts`, tests.
- **Acceptance:** the same rows and totals on the project page, its צפי (forecast) page and its edit page; the forecast card needs one request after `get_project`.
- **Measure:** the sweep's project page (the largest project), before and after.

### FLOW-1310 · Loan outlooks in the database (in review, #1284)

`public.loan_outlooks(p_today date default null)`: per open loan, the next payment (date, interest, escrow, principal, amount), the next 12 months' and the rest's totals, the end date and the late date (FLOW-1258's rule), from `loan_schedule_rows`, `loan_balances` (the rest of the schedule built from the balance on each read, about 1.6 ms a loan, about 35 ms for Flow QA), `loan_unsplit_payments` and the last paid day.
- **Built:** `private.loan_outlook_build(p_input jsonb)` (immutable, no table read; one loan: `{ today, loan, paid, dueDates? }` to `{ next, ahead_minor, to_end_minor, end_date, late_on }` without its nulls, `{}` for none) and `public.loan_outlooks(p_today)` (security invoker; an array of `{ loan_id, ... }` for the open loans with a built schedule that have a next payment or a late date, by loan id; `p_today` null is today in Israel, inline, since `authenticated` cannot execute `private.flow_today()`). The stored schedule gives the due dates (the late check and the first payment due); the rest is built from the balance on each read.
- **Vectors:** 32, in `packages/shared/fixtures/vectors/loan-outlook/`, from `loan-outlook.test.ts` (each kind, interest-only months ahead, the balloon, a zero balance, demand, closed, refused terms) and FLOW-1258's and FLOW-1263's late edges; run through the app's builders in `app/src/screens/loan-outlook-vectors.test.ts` and through `vectors_loan_outlook.test.sql`. `loans-paid.test.ts` has no outlook logic (it sums what was paid), so no vector comes from it.
- **Measured** (local Postgres 17, 22 invented loans of Flow QA's kinds with 11 rate rows and a payment each, warm, as the owner): about 34 ms a call and 6.0 KB for 21 answers (about 285 B a loan).
- **Files:** a migration and pgTAP with vectors from `loan-outlook.test.ts` and `loans-paid.test.ts`. No app change.
- **Acceptance:** every vector equal; about 40 ms warm for Flow QA, read-only.

### FLOW-1316 · The Loans list reads its outlooks (blocked: FLOW-1310)

Claimed once FLOW-1310's migration is on production.
- **Files:** `app/src/screens/loan-list.tsx` and its reads, `kept-rules.ts`, tests. The loan page keeps its own schedule (it draws every row). Coordinate with FLOW-1283 (the same list on the phone): whichever lands second keeps only what it still needs.
- **Acceptance:** the same list, band and late marks; the list's schedule math leaves the phone.
- **Measure:** the sweep's Loans, before and after; bytes.

### FLOW-1311 · Category months kept current on write (blocked: FLOW-1307; built only if FLOW-1307's read is over its budget)

`public.category_month_sums` and the deferred triggers of [section 3](#publiccategory_month_sums-flow-1311-only-if-needed), with the list derived from `pg_depend` and checked by a test; `private.project_category_months_lean` reads from it.
- **Acceptance:** the dependency test of section 3 (views resolved to base tables, each referenced column in its trigger's `update of` list); the parity check over every write path in pgTAP (a leg moved by `journal_entry_update`, a split part's project changed, a line removed, a line posted, a `pnl_role` change between project and shared (each of these on a project line and on a shared line with two allocated projects), a leg of a shared line changed, a review row opened and closed, an allocation, a category switch, the overhead project changed, a backfill with triggers disabled that ends with the rebuild); `company_next_month_inputs`, `project_category_months` and the forecast reads answer exactly as before; the write paths' added time measured on a local database (a 200-line sync, a split, a review answer, a category switch).
- **Measure:** the reads' database time before and after, as Flow QA, read-only.

### FLOW-1312 · flow-mcp reads the forecasts from the database (blocked: FLOW-1313; its second item also FLOW-1307)

`get_forecast` calls `month_forecast` (with the tool's `today` when given) instead of building from four reads (`supabase/functions/flow-mcp/tools.ts`, `tools_reports.ts`); with FLOW-1307 merged, a new `get_company_forecast` tool (spec, guide text, tests). The old tools stay.
- **Acceptance:** the MCP's answers equal the app's for the fixtures; `get_company_next_month_inputs` still answers as today.

## 7. Risks

| Risk | Where | How it is tested |
| --- | --- | --- |
| **Two rounding rules.** Averages round half away from zero (`roundDiv`); loan interest rounds half to even (`divHalfEven`, `private.div_half_even`); the annuity is an exact rational rounded half to even | FLOW-1306, FLOW-1307 | vectors with exact halves both ways, negative totals (refunds), a zero-rate loan, and `numeric` scale checks in pgTAP |
| **The annuity's size.** (1 + r/12)^360 as an exact fraction has about 2,550 digits | FLOW-1306 | `numeric` holds it (measured); vectors at 600 months (`LOAN_TERM_MONTHS_MAX`) and the highest rates in the tests |
| **The Israel day.** A read near midnight: the app's `israelToday()` and the database's `flow_today()` could differ across the server's UTC day, and a month's first or last day decides "this month" and the averages' window | every function | `p_today` always passed by the app; vectors at 23:30 and 00:30 Israel time on a month's last and first day, on both DST changes (2026-03-27, 2026-10-25), and on 31 December |
| **Month lengths.** A charge's usual day 31 in February (`expectedDate` clamps), leap years | FLOW-1307 | vectors for 2026-02, 2028-02 and day 29 to 31 charges |
| **The due rule.** `dueInMonth` (pace, next due month, end date) must match the SQL rule `expected_months` already uses (decision 0199) | FLOW-1313, FLOW-1307 | the existing `recurring-due.test.ts` cases as vectors for both |
| **Edits' precedence.** The latest start that applies wins; a removal beats a change; a skip (`skip:`) is listed apart from the page's removals; an added line matched in its month is arrived | FLOW-1307 | the existing tests' cases as vectors, plus two edits with the same start month |
| **Order and ties.** Hebrew sorting differs between ICU in the browser and the database's collation | all | the database returns unsorted rows with their keys; the app sorts as today; vectors compare rows as sets plus the totals |
| **Large integers in JSON.** A total over 2^53 would lose digits in a JSON number | all | a vector near 2^53; the pgTAP file asserts each amount is an integer under 2^53 (as `agorotSchema` does today) |
| **A loan the schedule refuses** (payment below interest, bad terms) | FLOW-1306 | `loan_schedule_meta.error` set; the forecast and outlook skip the loan as the app does today (`scheduleRowsOf` returns null); vectors for each refusal |
| **Kept data from before a switch** | FLOW-1314, FLOW-1308, FLOW-1315, FLOW-1316 | the new key is new; the old keys' rules are removed in the same PR, so nothing old is drawn under the new read |
| **A trigger that misses a write path** (FLOW-1306, FLOW-1311) | summary tables | a pgTAP case per write path in section 3's tables, and a parity function the daily report runs read-only on Flow QA |
| **Server time under concurrent calls** (FLOW-1300's gap) | the bigger reads | each slice reports the production mean and max a day after deploy |

## How the client math was timed

A scratch script, not committed (FLOW-1304 may commit a version of it under `app/perf/`): Node 22 with `tsx`, importing the app's own `companyNextMonthForecast`, `companyRestOfYear`, `companyMonthForecast`, `loanOutlook` and the shared `buildMonthForecast` from main at `bab03f8`, on invented inputs with Flow QA's counts (section 1) and loans of its kinds and terms, all in one currency. Median of 21 runs (11 or 5 for the long ones) after two warm-ups, on the cloud agent (4 cores, load average about 1). With the loans left out the same builds take 0.8 ms (next month) and 7.9 ms (11 months), which is how the loan schedules were found to be the cost.

| Build | today 2026-11-24 | today 2026-01-20 |
| --- | ---: | ---: |
| `JSON.parse` of a 117,768 B inputs answer | 0.3 ms | 0.3 ms |
| `companyNextMonthForecast` (next month) | 23.3 ms | 23.2 ms |
| `companyRestOfYear` | 23.1 ms (December only) | 275.0 ms (11 months) |
| `companyMonthForecast` for all 12 forecast months | 285.8 ms | 308.7 ms |
| `loanOutlook` for 22 loans | 12.2 ms | 11.5 ms |
| `buildMonthForecast` (108 parties, 29 edits) | 0.2 ms | 0.2 ms |

## How the database was measured

Production, read-only, as Flow QA's owner, never a write:

```sql
begin; set transaction read only;
select set_config('request.jwt.claims', json_build_object('sub', <the QA user's id>, 'role', 'authenticated')::text, true);
set local role authenticated;
-- a DO block timing each read with clock_timestamp() over 5 calls after a warm-up, results returned through set_config
rollback;
```

Only counts, sizes and times were read. `private.recurring_parties` is not executable by `authenticated`, so the recurring core was timed through `expected_months`, `recurring_schedule` and `missing_bills`.

## Not measured

- **The math on the phone.** The FLOW-804 phone figures here are Node times × 4. FLOW-1284 (realistic stub answers) and its profile measure them; FLOW-1304's acceptance uses Node and then that profile.
- **Write costs on production.** Read-only access cannot run a trigger; the costs above are the read-side recompute (category months) and an equivalent plpgsql loop (the schedule). Each summary-table slice measures its trigger on a local database.
- **The month forecast's answer size.** Estimated at 10 to 20 KB from the parties due and unseen; FLOW-1313 measures it.
- **Flow QA has no open invoices and no forecast overrides,** so `list_unpaid` and `forecast_overrides_for` were timed empty; the vectors cover both.
