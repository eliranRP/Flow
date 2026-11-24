import { z } from "zod";

/**
 * FLOW-1308: what a kept row of the company forecast and of the month forecast must look like before it is put back
 * (kept-rules.ts), in its JSON form: the amounts are bigints in the cache, digit strings as kept. Imported only by
 * read-schemas.ts, so zod and these stay out of Home's first load (the month forecast's check, FLOW-1314's, moved here from
 * kept-rules.ts to make room for the company forecast's rule in Home's entry: same checks).
 */
const minor = z.string().regex(/^-?\d+$/);
const count = z.number().int().min(0);
const facts = z.object({ rows: count, recurring: count, rent: count, name: z.string().nullable() });

export const companyForecastTotalsSchema = z.object({
  today: z.string(),
  currency: z.string(),
  months: z.array(z.object({
    month: z.string(),
    incomeMinor: minor,
    expenseMinor: minor,
    netMinor: minor,
    cashOnlyMinor: minor,
    projects: count,
    general: z.boolean(),
    income: facts,
  })),
  income: facts,
});

/** The month forecast as the page holds it: month, currency, the build's items and four lists, its two totals and the overrides. */
const item = z.object({ key: z.string(), name: z.string(), usual: minor, minor });

export const monthForecastKeptSchema = z.object({
  month: z.string(),
  base: z.string(),
  overrides: z.array(z.unknown()),
  build: z.object({
    items: z.array(item),
    income: z.array(item),
    expense: z.array(item),
    moved: z.array(item),
    small: z.array(item),
    incomeTotal: minor,
    expenseTotal: minor,
    changed: z.number(),
  }),
});
