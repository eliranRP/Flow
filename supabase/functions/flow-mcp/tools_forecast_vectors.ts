// The shared month-forecast vectors (packages/shared/fixtures/vectors/month-forecast) for tools_forecast_test.ts, as static JSON
// imports: flow-mcp's tests run with --allow-env only, and a computed import path needs --allow-read. The vector with payment
// terms is left out (month_forecast sets none: sample data only). Add a new vector's import and name here.

import v0 from "../../../packages/shared/fixtures/vectors/month-forecast/amount-near-2-pow-53.json" with { type: "json" };
import v1 from "../../../packages/shared/fixtures/vectors/month-forecast/amount-override-keeps-usual.json" with { type: "json" };
import v2 from "../../../packages/shared/fixtures/vectors/month-forecast/category-of-each-item.json" with { type: "json" };
import v3 from "../../../packages/shared/fixtures/vectors/month-forecast/due-on-override.json" with { type: "json" };
import v4 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-line-matched.json" with { type: "json" };
import v5 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-line.json" with { type: "json" };
import v6 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-add-zero-amount-is-out.json" with { type: "json" };
import v7 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-change-added-line.json" with { type: "json" };
import v8 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-change-recurring-charge.json" with { type: "json" };
import v9 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-latest-change-wins.json" with { type: "json" };
import v10 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-no-overhead-project-is-ignored.json" with { type: "json" };
import v11 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-on-another-project-is-ignored.json" with { type: "json" };
import v12 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-overhead-project-removal.json" with { type: "json" };
import v13 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-remove-added-line.json" with { type: "json" };
import v14 from "../../../packages/shared/fixtures/vectors/month-forecast/edit-remove-recurring-charge.json" with { type: "json" };
import v15 from "../../../packages/shared/fixtures/vectors/month-forecast/ended-charge-before-its-day-is-out.json" with { type: "json" };
import v16 from "../../../packages/shared/fixtures/vectors/month-forecast/ended-charge-long-ago-is-out.json" with { type: "json" };
import v17 from "../../../packages/shared/fixtures/vectors/month-forecast/handover-leaves-the-charge-out.json" with { type: "json" };
import v18 from "../../../packages/shared/fixtures/vectors/month-forecast/lists-parties-and-open-invoices.json" with { type: "json" };
import v19 from "../../../packages/shared/fixtures/vectors/month-forecast/monthly-no-pace-and-paid.json" with { type: "json" };
import v20 from "../../../packages/shared/fixtures/vectors/month-forecast/moved-out-override.json" with { type: "json" };
import v21 from "../../../packages/shared/fixtures/vectors/month-forecast/null-handover-counts-as-before.json" with { type: "json" };
import v22 from "../../../packages/shared/fixtures/vectors/month-forecast/other-currency-is-ignored.json" with { type: "json" };
import v23 from "../../../packages/shared/fixtures/vectors/month-forecast/override-wins-over-edit.json" with { type: "json" };
import v24 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-in-its-month-next-year.json" with { type: "json" };
import v25 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-in-its-month.json" with { type: "json" };
import v26 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-next-month-is-out.json" with { type: "json" };
import v27 from "../../../packages/shared/fixtures/vectors/month-forecast/quarter-charge-three-months-on-is-out.json" with { type: "json" };
import v28 from "../../../packages/shared/fixtures/vectors/month-forecast/small-charge-threshold.json" with { type: "json" };
import v29 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-invoice-project-name.json" with { type: "json" };
import v30 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-keys-by-project.json" with { type: "json" };
import v31 from "../../../packages/shared/fixtures/vectors/month-forecast/split-party-override-one-charge.json" with { type: "json" };
import v32 from "../../../packages/shared/fixtures/vectors/month-forecast/supplier-invoice-is-expense.json" with { type: "json" };
import v33 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-due-later-is-out.json" with { type: "json" };
import v34 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-due-this-month.json" with { type: "json" };
import v35 from "../../../packages/shared/fixtures/vectors/month-forecast/yearly-charge-late-counts.json" with { type: "json" };

export type MonthForecastVector = {
  name: string;
  input: { base: string; expected: { today: string; recurring: Record<string, unknown>[] }; unpaid: Record<string, unknown>[]; overrides: unknown[] };
  expected: { items: Record<string, unknown>[]; income: string[]; expense: string[]; moved: string[]; small: string[]; incomeTotal: number; expenseTotal: number; changed: number };
};

export const MONTH_FORECAST_VECTORS = [v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35] as unknown as MonthForecastVector[];
