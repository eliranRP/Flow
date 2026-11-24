import type { CategoryRow, ExpectedMonths, ProjectCategoryMonths } from "@flow/shared";
import { z } from "zod";
import { type ForecastLoan } from "./project-next-loans";
import { type ProjectForecastEdit } from "./project-next-month";
import { LOAN_DETAIL_COLUMNS, type LoanDetailDbRow, readLoanRow } from "./screens/loan-detail-data";
import { readyClient } from "./ready-client";

/**
 * What a story, a test or the dev fixture hands the screens instead of the read: the two forecast reads,
 * the user's edits, the project's loans, and the company's categories (the loan rows' categories and the
 * edit page's category sheet). The screens build the forecast from them with the TypeScript builders
 * (next-month-for-project.ts); a live page reads project_forecast instead (FLOW-1315, project-forecast-query.ts).
 */
export type NextMonthSample = {
  today: string;
  expected: ExpectedMonths;
  categoryMonths: ProjectCategoryMonths | null;
  edits?: ProjectForecastEdit[];
  loans?: ForecastLoan[];
  categories?: CategoryRow[];
};

/** The query key the company inputs sit under (the project edit writes refresh it, project-forecast-writes.ts; the month forecast's skip writes patch and drop it, forecast-month.ts). */
export const FORECAST_EDITS_KEY = "project-forecast-edits";

export const editSchema = z.object({
  id: z.string(),
  kind: z.enum(["change", "remove", "add"]),
  row_key: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable().optional(),
  direction: z.enum(["income", "expense"]).nullable(),
  amount_minor: z.number().nullable(),
  pace: z.enum(["once", "month", "2months", "quarter", "year"]),
  start_month: z.string(),
  matched_transaction_id: z.string().nullable().optional(),
});

type BalanceDbRow = { loan_id: string | null; balance_minor: number | null; flagged_parts: number | null };

/** Each row's balance, looked up by its loan id: a balance row of a loan not in `rows` is never read. */
function withBalances(rows: LoanDetailDbRow[], balances: BalanceDbRow[]): ForecastLoan[] {
  const byLoan = new Map(balances.map((row) => [row.loan_id, row]));
  return rows.map((row) => {
    const balance = byLoan.get(row.id);
    return readLoanRow(row, balance == null ? null : { balanceMinor: BigInt(balance.balance_minor ?? 0), flaggedParts: balance.flagged_parts ?? 0 });
  });
}

/**
 * Every loan of the company, as the loan page reads a loan: its row with the rates, and its balance in the books
 * (the payments left start from it, FLOW-427). The company's forecast (the overhead project's page and Profit) reads them.
 */
export async function readForecastLoans(): Promise<ForecastLoan[]> {
  const supabase = await readyClient();
  // The loans and their balances at once.
  const [loans, balances] = await Promise.all([
    supabase.from("loans").select(LOAN_DETAIL_COLUMNS),
    supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts"),
  ]);
  if (loans.error) throw loans.error;
  if (balances.error) throw balances.error;
  return withBalances(loans.data, balances.data);
}
