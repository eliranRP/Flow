import { z } from "zod";

/**
 * FLOW-161: get_pnl_statement (FLOW-160) and mcp_balance_sheet (FLOW-152), parsed. Only read-schemas.ts
 * re-exports this file, so zod loads next to the read, not with Home's first paint.
 */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const childSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  amount_minor: minorSchema,
  count: z.number().int().nonnegative(),
});

const nodeSchema = childSchema.extend({
  own_minor: minorSchema,
  children: z.array(childSchema),
});

const keptOutSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  direction: z.enum(["income", "expense"]),
  amount_minor: minorSchema,
  count: z.number().int().nonnegative(),
  account_name: z.string().nullable(),
  account_type: z.string().nullable(),
});

const statementCurrencySchema = z.object({
  currency: z.string(),
  income_minor: minorSchema,
  expense_minor: minorSchema,
  net_minor: minorSchema,
  income: z.array(nodeSchema),
  expense: z.array(nodeSchema),
  kept_out: z.array(keptOutSchema),
});

export const pnlStatementSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  basis: z.string(),
  project_id: z.string().nullable(),
  project_name: z.string().nullable(),
  by_project: z.boolean(),
  currencies: z.array(statementCurrencySchema),
  projects: z.array(z.object({
    key: z.string(),
    project_id: z.string().nullable(),
    name: z.string().nullable(),
    currencies: z.array(statementCurrencySchema),
  })),
  review_count: z.number().int().nonnegative(),
});

const accountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  is_system: z.boolean(),
  balance_minor: minorSchema,
});

const sideSchema = z.object({ total_minor: minorSchema, accounts: z.array(accountSchema) });

export const balanceSheetSchema = z.object({
  as_of: z.string(),
  project_id: z.string().nullable(),
  project_name: z.string().nullable(),
  currencies: z.array(z.object({
    currency: z.string(),
    assets: sideSchema,
    liabilities: sideSchema,
    equity: sideSchema,
    retained_earnings_minor: minorSchema,
    total_assets_minor: minorSchema,
    total_liabilities_and_equity_minor: minorSchema,
    difference_minor: minorSchema,
    balanced: z.boolean(),
    warnings: z.array(z.object({
      code: z.enum(["suspense", "uncategorized"]),
      account_id: z.string(),
      account_name: z.string(),
      balance_minor: minorSchema,
    })),
  })),
});
