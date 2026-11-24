# Shared test vectors

One set of JSON vectors per builder, run against the TypeScript builder today and against the database cores as each one lands ([FLOW-1275](../../../../docs/tech/flow-1275-server-side-math.md), slice 2). A database core has to give exactly the figures the TypeScript builder gives; a vector is the proof, in both places.

Everything here is invented. No real names, amounts, ids or dates.

## Layout

```
vectors/
  month-forecast/<name>.json   buildMonthForecast (packages/shared/src/month-forecast.ts)
  loan-schedule/<name>.json    buildLoanSchedule (packages/shared/src/loan-schedule.ts)
  loan-outlook/<name>.json     loanOutlook and latePayment (app/src/screens/loan-outlook.ts)
  company-forecast/<name>.json companyNextMonthForecast for each month asked (app/src/company-next-month.ts and
                               company-year-forecast.ts, with project-next-month.ts and project-next-loans.ts)
```

One vector per file, and the file is named `<name>.json`.

## Format

```json
{ "name": "kebab-case-name", "description": "One sentence on what it pins.", "input": {}, "expected": {} }
```

- `input` is what the builder takes, as JSON. **Every amount is an integer in minor units**, a plain JSON number inside 2^53 - 1 (the test checks it), so a database reads it exactly. The TypeScript builders take `bigint` for some of them; `vectors.test.ts` converts on the way in and out. Anything a JSON number cannot hold (`NaN`) is not a vector.
- `expected` is the builder's answer in the same shape, amounts as numbers.

### month-forecast

`input` is `buildMonthForecast`'s argument: `{ base, expected, unpaid, overrides, edits?, overheadProjectId?, paymentTermsDays? }`. Its `expected` is the `expected_months` read (`today` and `recurring`, with `months` left empty). The vector's own `expected` is:

```
{ items: ForecastItem[],            every item, in the builder's order
  income, expense, moved, small,    the item keys of each list, in the builder's order
  incomeTotal, expenseTotal, changed }
```

### loan-schedule

`input` is `LoanTerms`: `principalMinor`, `annualRatePpm`, `termMonths`, `startDate`, `paymentMinor`, `escrowMinor`, and optionally `kind`, `interestOnlyMonths`, `amortizationMonths`, `rates`. `paymentMinor` is always the literal payment (a vector never calls `regularPaymentMinor`). `expected` is one of:

```
{ rows: [{ period, dueDate, interestMinor, escrowMinor, principalMinor, paymentMinor, balanceMinor }],
  balloon: { amountMinor, ratioToPayment } | null,
  finalAdjustment: { amountMinor } | null }

{ error: "<LoanScheduleError code>" }       a refused term
```

`ratioToPayment` is a double: compare it as one.

### loan-outlook

`input` is `{ today, loan, paid }`: `today` is yyyy-mm-dd; `loan` is the `LoanTerms` of a loan (as in loan-schedule, `paymentMinor` and `termMonths` null for a demand loan) plus `status` and `balanceMinor`, the balance in the books; `paid` is `{ lastPaidOn, addedOn }` (yyyy-mm-dd or null), the facts of FLOW-1258's late check. The database core also takes an optional `dueDates` (the due dates of the loan's own stored schedule); a vector never has it, so the core builds them. `expected` is what the Loans list needs of the loan, leaving out what is null (absent = null); `{}` is a loan with no outlook that is not late:

```
{ next: { due_date, interest_minor, escrow_minor, principal_minor, amount_minor },   the payment due on or after today, from the balance
  ahead_minor,                the next 12 payments' total
  to_end_minor,               every payment left
  end_date,                   the last payment's due date
  late_on }                   the due date of a payment past its grace with nothing recorded for it
```

The vectors run through the app's own builders in `app/src/screens/loan-outlook-vectors.test.ts` (they live in `app/`, where `packages/shared` cannot import them), not in `vectors.test.ts`.

### company-forecast

`input` is what the app's company forecast is built from, for the months asked (FLOW-1307):

```
{ currency, today,                    the company currency; yyyy-mm-dd
  months: [yyyy-mm],                  the months to build, in the order asked
  recurring: ExpectedParty[],         expected_months' recurring[] (typical_amount_minor a number)
  loans: [{ id, currency, projectId, status, balanceMinor, categoryIds: { interest, escrow },
            principalMinor, annualRatePpm, termMonths, startDate, paymentMinor, escrowMinor, kind,
            interestOnlyMonths, amortizationMonths, rates }],   rates oldest first, as in loan-schedule
  categories: [{ id, name, loan_part, excluded_from_pnl, parent_id }],   list_categories' order
  inputs: CompanyNextMonthInputs }    company_next_month_inputs (rest_edits and skips optional)
```

The database core also takes an optional `dueDates` on a loan (its stored schedule's due dates) and `detail: "totals"`; a vector has neither. `expected` is, leaving out what is null (absent = null):

```
{ months: [{ month, income_minor, expense_minor, net_minor, cash_only_minor, projects, general,
             income: { rows, recurring, rent, name },
             parts: [{ project_id, income_minor, expense_minor, cash_only_minor, average_months,
                       rows, removed, arrived, loan_cash: [{ loan_id, row_category_ids, minor }] }],
             skipped: [{ project_id, ...row }] }],
  income: { rows, recurring, rent, name },     each income stream once over the months (restIncomeNote)
  split_keys: [...] }
```

A row is `{ key, kind, direction, name, date, minor, category_id, was_minor, pace }`. Each list has its rows by key (then amount, day and name), then the lines the user added in the edits' order, as the builder lists them (the app sorts the rest, and cannot rebuild the edits' order from the keys). The parts are the projects with a row by id, then the general costs (no `project_id`), listed even with no row, as `companyGeneralForecast` gives them; they count in the totals only with a row. The vectors run through the app's builders in `app/src/company-forecast-vectors.test.ts`.

## Where they run

- `packages/shared/src/vectors.test.ts` (vitest) runs every month-forecast and loan-schedule vector through the TypeScript builder; `app/src/screens/loan-outlook-vectors.test.ts` runs the loan-outlook vectors and `app/src/company-forecast-vectors.test.ts` the company-forecast ones.
- `scripts/vectors-sql.mjs` writes `supabase/tests/database/vectors_<builder>.test.sql` for each builder whose SQL core is in a migration: it calls `private.<core>(input::jsonb)` and expects `expected::jsonb`, one `is` per vector. All four cores exist: `private.month_forecast_build(p_input jsonb)` (FLOW-1313), `private.loan_schedule(p_terms jsonb)` (FLOW-1306), `private.loan_outlook_build(p_input jsonb)` (FLOW-1310) and `private.company_forecast_build(p_input jsonb)` (FLOW-1307), as the FLOW-1275 plan names them. A refused loan-schedule vector (`{ error }`) is checked with `throws_ok`, SQLSTATE `22023` and the code as the message. `node scripts/vectors-sql.mjs --check` is in the gate: it fails when a generated file is stale (or one is left for a core that is gone). After a vector changes, run `node scripts/vectors-sql.mjs` and commit the result.

Each core gives the vector's `expected` exactly, as one jsonb value (no row sets, no totals compared apart). A core's answer has the vectors' own shape, so no mapping sits between the files and the database.

## Adding a vector

Write the file with the `expected` you worked out by hand or from the owner's rule, not copied unchecked from a builder's output. Run `pnpm --filter @flow/shared test`. A case the database must also keep goes in here first.
