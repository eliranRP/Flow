import { dueInMonth, type ExpectedParty, monthIndex, paceMonths, type ProjectCategoryMonths } from "@flow/shared";
import { type ForecastCategory, type ForecastLoan, type LoanCash, loanCashOnly, loanParts } from "./project-next-loans";

/**
 * A project's forecast for next month (the ProfitProject card, the ProfitNext page and its edit page), in
 * profit terms: the project's recurring charges due that month, its loans' interest and escrow for that
 * month, plus one average row for each other expense category. Pure: the screens pass in what
 * expected_months, project_category_months, the project's loans and the company's categories read.
 *
 * - A recurring charge that pays a loan (`pays_loan`) is cash, not profit: its usual amount is the whole
 *   payment, principal included. It is left out of the recurring rows.
 * - The loan's profit parts come from the loan itself (decision 0190): for each open loan filed under the
 *   project with a schedule (not a demand loan), in the forecast's currency, the payment due that month as
 *   the loan page shows it (its payments left, from the balance in the books: FLOW-427, loan-outlook's
 *   paymentsLeft) gives its interest in the loan's interest category and its escrow in its escrow category
 *   (the loan's own, else the company's keyed one; none when kept out of the profit). So next month's rows
 *   are the loan page's next payment. Several loans in one category sum into one row. A month before the
 *   first payment left or after the last (the balance paid off), or a closed or paid-off loan, gives nothing. The row keeps
 *   the key `avg:<category>`, so the user's edits of that category's row still apply.
 * - A category is left out of the averages as soon as any recurring charge of the project (a loan payment
 *   aside) files to it, even one not due next month, so a one-off cost in that category drops out of the
 *   forecast too; and as soon as a loan row fills it.
 * - Uncategorized expenses are one average row named אחר.
 * - An average is over the months of the window from the project's first expense in it, so a project
 *   younger than six months is not divided by six.
 * - The user's edits (project_forecast_edits) go on top: applyForecastEdits changes a row's amount, takes
 *   a row out, or adds a line of a category, for the edits that apply to the month.
 * - The rest of the same payments, which the profit leaves out (the principal, and an interest or escrow part
 *   kept out of the profit or with no category), is kept apart (`cashOnlyMinor`), never a row or in the
 *   totals. cashForecast adds it for the project page, whose net is תזרים צפוי (decision 0196). A loan whose
 *   every row the user took out adds none: the owner says that payment will not happen.
 */

/** The months an average row looks back over: the last six complete months. */
const AVERAGE_MONTHS = 6;

/** The name of the uncategorized expenses' average row. */
const UNCATEGORIZED = "אחר";

/** Under a loan row's name: its interest or escrow comes from the loan's schedule (decision 0190). */
export const LOAN_SOURCE = "לפי ההלוואה";

/** How often an edit applies: its month only, or every pace months from it. */
export type ForecastPace = "once" | "month" | "2months" | "quarter" | "year";

/** One row of project_forecast_edits, as project_forecast_edits_for lists it. */
export type ProjectForecastEdit = {
  id: string;
  kind: "change" | "remove" | "add";
  /** The row a change or a removal is of; null on an added line (its key is `add:<id>`). */
  row_key: string | null;
  category_id: string | null;
  category_name?: string | null;
  direction: "income" | "expense" | null;
  amount_minor: number | null;
  pace: ForecastPace;
  /** yyyy-mm */
  start_month: string;
  /** An added line: the bank line that came as it in the month read (decision 0187); null when none came. */
  matched_transaction_id?: string | null;
};

/** One expected line next month: signed (income positive, an expense negative), in minor units. */
export type NextMonthRow = {
  key: string;
  /** A recurring charge, a loan's interest or escrow, a category's average, or a line the user added. */
  kind: "recurring" | "loan" | "average" | "added";
  /** Money in or out: a change keeps it, whatever the amount (a zero row included). */
  direction: "income" | "expense";
  name: string;
  /** yyyy-mm-dd, the expected day of a recurring charge; null on the other rows. */
  date: string | null;
  minor: bigint;
  /** The category the row files to (an average's or a loan row's own, a charge's, an added line's); null when none. */
  categoryId: string | null;
  /** Flow's number before the user changed it; null when the row is Flow's. */
  wasMinor: bigint | null;
  /** An added line's pace. */
  pace: ForecastPace | null;
};

export type NextMonthForecast = {
  /** yyyy-mm */
  month: string;
  rows: NextMonthRow[];
  /** Positive totals. */
  incomeMinor: bigint;
  expenseMinor: bigint;
  /** Income less expenses, before the share of general expenses. */
  netMinor: bigint;
  /** The loan rows: the צפי page's note names the loan's schedule when there are some. */
  loanCount: number;
  /** The months the averages are over: the window from the project's first expense in it. */
  averageMonths: number;
  /** Each loan's rest of its payment due in the month, which the profit leaves out (loanCashOnly). */
  loanCash: LoanCash[];
  /**
   * The rest of the loans' payments that the profit leaves out, less the loans whose every row was taken
   * out: cash, not profit, so in no row and no total here. cashForecast adds it.
   */
  cashOnlyMinor: bigint;
  /** Rows the user took out of the month, with the amount they would have. */
  removed: NextMonthRow[];
  /**
   * Lines the user added whose bank line already came in the month (decision 0187). Like a recurring
   * charge seen this month, they are no longer expected: they leave the totals.
   */
  arrived: NextMonthRow[];
};

/** yyyy-mm of the month after the day's month. */
export function nextMonthKey(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(month + 1).padStart(2, "0")}`;
}

/** yyyy-mm-dd: the typical day in the month, clamped to the month's length. */
export function expectedDate(month: string, typicalDay: number): string {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const day = Math.min(Math.max(Math.trunc(typicalDay), 1), last);
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** a / b rounded half away from zero (b positive). */
function roundDiv(a: bigint, b: bigint): bigint {
  const half = b / 2n;
  return a < 0n ? -((-a + half) / b) : (a + half) / b;
}

/**
 * The months an average divides by: from the first month of the window with any of the project's expenses
 * (every category and currency) to the window's end, at least 1. project_category_months fills the months
 * before the project's first line with zeros, so a younger project would otherwise be divided by six.
 */
function averageMonths(months: ProjectCategoryMonths | null | undefined): number {
  const categories = months?.categories ?? [];
  const length = categories.reduce((most, category) => Math.max(most, category.months_minor.length), 0) || AVERAGE_MONTHS;
  let first = length;
  for (const category of categories) {
    const index = category.months_minor.findIndex((value) => value !== 0);
    if (index >= 0 && index < first) first = index;
  }
  return Math.max(length - first, 1);
}

/** The average rows: one per expense category of the currency no recurring charge or loan row fills. */
function averageRows(
  months: ProjectCategoryMonths | null | undefined,
  currency: string,
  filled: ReadonlySet<string>,
  divisor: number,
): NextMonthRow[] {
  const rows: NextMonthRow[] = [];
  for (const category of months?.categories ?? []) {
    if (category.currency !== currency || (category.id != null && filled.has(category.id))) continue;
    const total = category.months_minor.reduce((sum, value) => sum + BigInt(value), 0n);
    const average = roundDiv(total, BigInt(divisor));
    // A category whose refunds outweigh its costs has nothing to expect.
    if (average <= 0n) continue;
    const base = { kind: "average" as const, direction: "expense" as const, date: null, minor: -average, categoryId: category.id, wasMinor: null, pace: null };
    rows.push(category.id == null
      ? { ...base, key: "avg:none", name: UNCATEGORIZED }
      : { ...base, key: `avg:${category.id}`, name: category.name ?? "" });
  }
  return rows.sort(byAmount);
}

/** The biggest cost first, then by name. */
function byAmount(a: NextMonthRow, b: NextMonthRow): number {
  return a.minor === b.minor ? a.name.localeCompare(b.name, "he") : a.minor < b.minor ? -1 : 1;
}

function signedAmount(party: ExpectedParty): bigint {
  const abs = party.typical_amount_minor < 0n ? -party.typical_amount_minor : party.typical_amount_minor;
  return party.direction === "income" ? abs : -abs;
}

/**
 * Next month's rows for one project and currency: the recurring ones by expected day (a loan payment
 * left out), then the loan rows, the averages last.
 */
export function nextMonthForecast(input: {
  projectId: string;
  currency: string;
  today: string;
  recurring: readonly ExpectedParty[];
  categoryMonths: ProjectCategoryMonths | null | undefined;
  /** The project's loans, and the company's categories their parts file to. */
  loans?: readonly ForecastLoan[];
  categories?: readonly ForecastCategory[];
}): NextMonthForecast {
  const month = nextMonthKey(input.today);
  const thisMonth = input.today.slice(0, 7);
  // A loan payment is not a profit line: the loan's own rows stand for its interest and escrow.
  const charges = input.recurring.filter((party) => party.project_id === input.projectId && party.pays_loan !== true);
  const loanMonth = { projectId: input.projectId, currency: input.currency, month, today: input.today, loans: input.loans ?? [] };
  const loans = loanParts({ ...loanMonth, categories: input.categories ?? [] })
    .map((part): NextMonthRow => ({
      key: `avg:${part.categoryId}`,
      kind: "loan",
      direction: "expense",
      name: part.name,
      date: null,
      minor: -part.minor,
      categoryId: part.categoryId,
      wasMinor: null,
      pace: null,
    }))
    .sort(byAmount);
  const filled = new Set([
    ...charges.flatMap((party) => (party.category_id == null ? [] : [party.category_id])),
    ...loans.flatMap((row) => (row.categoryId == null ? [] : [row.categoryId])),
  ]);
  const recurring = charges
    .filter((party) => party.currency === input.currency && dueInMonth(party.next_due_month, party.pace, month, thisMonth))
    .map((party): NextMonthRow => ({
      key: `rec:${party.direction}:${party.party_id}`,
      kind: "recurring",
      direction: party.direction,
      name: party.name,
      date: expectedDate(month, party.typical_day),
      minor: signedAmount(party),
      categoryId: party.category_id ?? null,
      wasMinor: null,
      pace: null,
    }))
    .sort((a, b) => ((a.date ?? "") === (b.date ?? "") ? a.name.localeCompare(b.name, "he") : (a.date ?? "") < (b.date ?? "") ? -1 : 1));
  const divisor = averageMonths(input.categoryMonths);
  const averages = averageRows(input.categoryMonths, input.currency, filled, divisor);
  return withTotals(month, [...recurring, ...loans, ...averages], divisor, loanCashOnly({ ...loanMonth, categories: input.categories ?? [] }), [], []);
}

function withTotals(
  month: string,
  rows: NextMonthRow[],
  divisor: number,
  loanCash: LoanCash[],
  removed: NextMonthRow[],
  arrived: NextMonthRow[],
): NextMonthForecast {
  const incomeMinor = rows.reduce((sum, row) => (row.minor > 0n ? sum + row.minor : sum), 0n);
  const expenseMinor = rows.reduce((sum, row) => (row.minor < 0n ? sum - row.minor : sum), 0n);
  const removedKeys = new Set(removed.map((row) => row.key));
  const cashOnlyMinor = loanCash
    .filter((loan) => loan.rowCategoryIds.length === 0 || !loan.rowCategoryIds.every((id) => removedKeys.has(`avg:${id}`)))
    .reduce((sum, loan) => sum + loan.minor, 0n);
  return {
    month,
    rows,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    loanCount: rows.filter((row) => row.kind === "loan").length,
    averageMonths: divisor,
    loanCash,
    cashOnlyMinor,
    removed,
    arrived,
  };
}

/** Whether an edit that starts in `start` on `pace` applies to `month` (private.pfe_hits). */
export function editApplies(start: string, pace: ForecastPace, month: string): boolean {
  const gap = monthIndex(month) - monthIndex(start);
  if (gap < 0) return false;
  if (pace === "once") return gap === 0;
  return gap % (pace === "month" ? 1 : paceMonths(pace)) === 0;
}

/** The key of the row a line the user added makes. */
export function addedKey(editId: string): string {
  return `add:${editId}`;
}

/**
 * The forecast with the user's edits on top: the lines they added (each in its category's name), then
 * each row's change (the latest start that applies wins, the sign stays the row's) and the rows they
 * took out, which leave the totals and are listed apart. Edits that do not apply to the month are ignored.
 * An added line whose bank line already came in the month (`matched_transaction_id`) is arrived: it leaves
 * the totals too, so a line is never counted as both expected and in.
 */
export function applyForecastEdits(forecast: NextMonthForecast, edits: readonly ProjectForecastEdit[]): NextMonthForecast {
  const month = forecast.month;
  const applying = edits.filter((edit) => editApplies(edit.start_month, edit.pace, month));
  if (applying.length === 0) return forecast;
  const arrivedKeys = new Set(applying.flatMap((edit) => (edit.kind === "add" && edit.matched_transaction_id != null ? [addedKey(edit.id)] : [])));
  const added = applying.flatMap((edit): NextMonthRow[] => {
    if (edit.kind !== "add" || edit.amount_minor == null) return [];
    const amount = BigInt(edit.amount_minor);
    return [{
      key: addedKey(edit.id),
      kind: "added",
      direction: edit.direction === "income" ? "income" : "expense",
      name: edit.category_name ?? "",
      date: null,
      minor: edit.direction === "income" ? amount : -amount,
      categoryId: edit.category_id,
      wasMinor: null,
      pace: edit.pace,
    }];
  });
  const changes = new Map<string, ProjectForecastEdit>();
  const removedKeys = new Set<string>();
  for (const edit of applying) {
    if (edit.row_key == null) continue;
    if (edit.kind === "remove") removedKeys.add(edit.row_key);
    if (edit.kind !== "change" || edit.amount_minor == null) continue;
    const held = changes.get(edit.row_key);
    if (held == null || held.start_month < edit.start_month) changes.set(edit.row_key, edit);
  }
  const rows = [...forecast.rows, ...added].map((row) => {
    const change = changes.get(row.key);
    if (change?.amount_minor == null) return row;
    const amount = BigInt(change.amount_minor);
    return { ...row, minor: row.direction === "income" ? amount : -amount, wasMinor: row.minor };
  });
  return withTotals(
    month,
    rows.filter((row) => !removedKeys.has(row.key) && !arrivedKeys.has(row.key)),
    forecast.averageMonths,
    forecast.loanCash,
    rows.filter((row) => removedKeys.has(row.key)),
    rows.filter((row) => !removedKeys.has(row.key) && arrivedKeys.has(row.key)),
  );
}

/**
 * The forecast in cash terms, for the project page (decision 0196: the owner's real cash): its expenses
 * with the rest of the loans' payments due in the month that the profit leaves out (`cashOnlyMinor`), and
 * the net less it. The rows stay the profit forecast's, so the צפי page it opens differs by that alone.
 */
export function cashForecast(forecast: NextMonthForecast): NextMonthForecast {
  if (forecast.cashOnlyMinor === 0n) return forecast;
  return {
    ...forecast,
    expenseMinor: forecast.expenseMinor + forecast.cashOnlyMinor,
    netMinor: forecast.netMinor - forecast.cashOnlyMinor,
  };
}

/** The project's average monthly share of general expenses: its share for the period over the period's months. */
export function monthlyOverheadShare(share: bigint | null, months: number): bigint | null {
  if (share == null || months <= 0) return null;
  return roundDiv(share, BigInt(months));
}
