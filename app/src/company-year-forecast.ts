import { companyIncomeNote, companyNextMonthForecast, type CompanyForecastEdit, type CompanyNextMonth, type CompanyNextMonthInputs } from "./company-next-month";
import type { RentCategory } from "./next-month-chart";
import { nextMonthKey } from "./project-next-month";
import { HEBREW_MONTHS } from "./ui/date-math";

/**
 * The company's forecast for the rest of the year (canvas note spec-years, decision 0200), pure: next month's
 * company forecast (every project's צפי page and the general costs, decision 0197) built again for each month
 * left in this year, from the same reads. Recurring charges come by the shared due rule (`dueInMonth`), the
 * loans by their schedules, the averages stay the six-month ones, and each month gets the owner's edits that
 * apply to it (company_next_month_inputs' `rest_edits`).
 */

type CompanyForecastInput = Omit<Parameters<typeof companyNextMonthForecast>[0], "month">;

/** One month left in the year: its positive totals. */
export type RestOfYearMonth = { month: string; incomeMinor: bigint; expenseMinor: bigint };

export type RestOfYear = {
  /** yyyy */
  year: string;
  /** Oldest first: next month to December. */
  months: RestOfYearMonth[];
  /** Positive totals over the months. */
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
  /** Each month's forecast, for the captions. */
  forecasts: CompanyNextMonth[];
};

/** yyyy-mm of every month after today's to December of the same year; none in December. */
export function restOfYearMonths(today: string): string[] {
  const year = today.slice(0, 4);
  const months: string[] = [];
  for (let month = nextMonthKey(today); month.startsWith(year); month = nextMonthKey(`${month}-01`)) months.push(month);
  return months;
}

/**
 * Each month's edits: the read's rest-of-year edits (every edit that applies to a month left, so a 2-month edit
 * started in October reaches December), each added one matched by its own month's line. The builder keeps the
 * edits that apply to the month. Without them (an older payload), next month's edits, matched in next month only.
 */
function monthEdits(inputs: CompanyNextMonthInputs, month: string): CompanyForecastEdit[] {
  if (inputs.rest_edits == null) {
    return month === inputs.month ? inputs.edits : inputs.edits.map((edit) => ({ ...edit, matched_transaction_id: null }));
  }
  return inputs.rest_edits.map(({ matches, ...edit }) => ({ ...edit, matched_transaction_id: matches?.[month] ?? null }));
}

/**
 * The rest of the year for the whole company, or null in December (nothing is left). A line that already came
 * against an added edit leaves that month only; in another month the edit is expected again.
 */
export function companyRestOfYear(input: CompanyForecastInput): RestOfYear | null {
  const months = restOfYearMonths(input.today);
  if (months.length === 0) return null;
  const forecasts = months.map((month) => companyNextMonthForecast({
    ...input,
    inputs: { ...input.inputs, edits: monthEdits(input.inputs, month) },
    month,
  }));
  const incomeMinor = forecasts.reduce((sum, forecast) => sum + forecast.incomeMinor, 0n);
  const expenseMinor = forecasts.reduce((sum, forecast) => sum + forecast.expenseMinor, 0n);
  return {
    year: input.today.slice(0, 4),
    months: forecasts.map((forecast) => ({ month: forecast.month, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor })),
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    forecasts,
  };
}

function monthName(month: string): string {
  return HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
}

/** The months the card sums, in its grey corner: "דצמבר", "נובמבר ודצמבר", "מרץ עד דצמבר". */
export function restMonthsCaption(rest: Pick<RestOfYear, "months">): string {
  const first = rest.months[0]?.month;
  const last = rest.months.at(-1)?.month;
  if (first == null || last == null) return "";
  if (first === last) return monthName(first);
  return rest.months.length === 2 ? `${monthName(first)} ו${monthName(last)}` : `${monthName(first)} עד ${monthName(last)}`;
}

/**
 * Under הכנסות צפויות: what the income is made of, each stream once however many months it comes in ("6
 * שכירויות ו־2 הכנסות"), as next month's card names it.
 */
export function restIncomeNote(rest: Pick<RestOfYear, "forecasts">, categories: readonly RentCategory[]): string {
  const rows = new Map<string, CompanyNextMonth["rows"][number]>();
  for (const forecast of rest.forecasts) {
    for (const row of forecast.rows) {
      if (row.minor > 0n && !rows.has(`${row.projectId ?? ""}:${row.key}`)) rows.set(`${row.projectId ?? ""}:${row.key}`, row);
    }
  }
  return companyIncomeNote({ rows: [...rows.values()] }, categories);
}

/** Under הוצאות צפויות: the board's "קבועים וממוצעים", or none expected. */
export function restExpenseNote(rest: Pick<RestOfYear, "expenseMinor">): string {
  return rest.expenseMinor === 0n ? "אין הוצאות צפויות" : "קבועים וממוצעים";
}
