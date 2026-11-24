# Shared test vectors

One set of JSON vectors per builder, run against the TypeScript builder today and against the database cores as each one lands ([FLOW-1275](../../../../docs/tech/flow-1275-server-side-math.md), slice 2). A database core has to give exactly the figures the TypeScript builder gives; a vector is the proof, in both places.

Everything here is invented. No real names, amounts, ids or dates.

## Layout

```
vectors/
  month-forecast/<name>.json   buildMonthForecast (packages/shared/src/month-forecast.ts)
  loan-schedule/<name>.json    buildLoanSchedule (packages/shared/src/loan-schedule.ts)
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

## Where they run

- `packages/shared/src/vectors.test.ts` (vitest) runs every vector through the TypeScript builder.
- `scripts/vectors-sql.mjs` writes `supabase/tests/database/vectors_<builder>.test.sql` for each builder whose SQL core is in a migration: it calls `public.<core>(input::jsonb)` and expects `expected::jsonb`. The cores are `public.month_forecast_core(jsonb)` and `public.loan_schedule_core(jsonb)`, each returning the `expected` shape; the slice that adds one changes the name in the script if it differs. No core exists yet, so nothing is written. `node scripts/vectors-sql.mjs --check` is in the gate: it fails when a generated file is stale (or one is left for a core that is gone). After a vector changes, run `node scripts/vectors-sql.mjs` and commit the result.

## Adding a vector

Write the file with the `expected` you worked out by hand or from the owner's rule, not copied unchecked from a builder's output. Run `pnpm --filter @flow/shared test`. A case the database must also keep goes in here first.
