import { z } from "zod";

/**
 * FLOW-1315: what a kept project forecast (kept-rules.ts) must look like before it is put back, in its JSON form: the amounts
 * are bigints in the cache, digit strings as kept. Imported only by read-schemas.ts, so zod and this stay out of Home's first load
 * (as company-forecast-schema.ts, FLOW-1308: the checks sit in the lazy chunk, and Home's entry carries only the rule).
 */
const minor = z.string().regex(/^-?\d+$/);
const count = z.number().int().min(0);
const pace = z.enum(["once", "month", "2months", "quarter", "year"]);

const row = z.object({
  key: z.string(),
  kind: z.enum(["recurring", "loan", "average", "added"]),
  direction: z.enum(["income", "expense"]),
  name: z.string(),
  date: z.string().nullable(),
  minor,
  categoryId: z.string().nullable(),
  wasMinor: minor.nullable(),
  pace: pace.nullable(),
});

export const projectForecastKeptSchema = z.object({
  today: z.string(),
  month: z.string(),
  currency: z.string(),
  general: z.boolean(),
  forecast: z.object({
    month: z.string(),
    rows: z.array(row),
    incomeMinor: minor,
    expenseMinor: minor,
    netMinor: minor,
    loanCount: count,
    averageMonths: count,
    loanCash: z.array(z.never()),
    cashOnlyMinor: minor,
    removed: z.array(row),
    skipped: z.array(row),
    arrived: z.array(z.never()),
  }),
  income: z.object({ rows: count, recurring: count, rent: count, name: z.string().nullable() }),
  edited: z.boolean(),
  cashPending: z.boolean(),
  overrides: z.array(z.object({ item_key: z.string(), amount_minor: z.number().int().nullable(), due_on: z.string().nullable(), moved_out: z.boolean() })),
  history: z.object({
    months: z.array(z.string()),
    categories: z.array(z.object({ id: z.string().nullable(), currency: z.string(), months_minor: z.array(z.number().int()) })),
  }),
  charges: z.array(z.object({
    project_id: z.string(),
    pays_loan: z.literal(false),
    currency: z.string(),
    category_id: z.string(),
    typical_amount_minor: minor,
    pace: z.enum(["month", "2months", "quarter", "year"]),
  })),
});
