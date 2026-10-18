import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";

/**
 * A project's forecast for next month (the ProfitProject card and the ProfitNext page), in profit terms:
 * the project's recurring charges due that month, plus one average row for each expense category no
 * recurring charge of the project files to. Pure: the screens pass in what expected_months and
 * project_category_months read.
 *
 * - A recurring charge that pays a loan (`pays_loan`) is cash, not profit: its usual amount is the whole
 *   payment, principal included. It is left out of the recurring rows, and the loan's profit parts
 *   (interest, escrow) come in as the averages of their own categories, which count no principal.
 * - A category is left out of the averages as soon as any recurring charge of the project (a loan payment
 *   aside) files to it, even one not due next month, so a one-off cost in that category drops out of the
 *   forecast too.
 * - Uncategorized expenses are one average row named אחר.
 * - An average is over the months of the window from the project's first expense in it, so a project
 *   younger than six months is not divided by six.
 */

/** The months an average row looks back over: the last six complete months. */
const AVERAGE_MONTHS = 6;

/** The name of the uncategorized expenses' average row. */
const UNCATEGORIZED = "אחר";

type Pace = NonNullable<ExpectedParty["pace"]>;

/** One expected line next month: signed (income positive, an expense negative), in minor units. */
export type NextMonthRow = {
  key: string;
  kind: "recurring" | "average";
  name: string;
  /** yyyy-mm-dd, the expected day; null on an average row. */
  date: string | null;
  minor: bigint;
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
  recurringCount: number;
  /** The average rows' category names, in row order. */
  averageNames: string[];
  /** The months the averages are over: the window from the project's first expense in it. */
  averageMonths: number;
};

/** yyyy-mm of the month after the day's month. */
export function nextMonthKey(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(month + 1).padStart(2, "0")}`;
}

function paceMonths(pace: Pace | null | undefined): number {
  if (pace === "2months") return 2;
  if (pace === "quarter") return 3;
  if (pace === "year") return 12;
  return 1;
}

function monthIndex(key: string): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
}

/**
 * Whether a charge comes in `month`: from its due month, every pace months. A charge that is late (its due
 * month already passed) counts from this month, as expected_months counts it, so the two never disagree.
 */
export function dueInMonth(nextDue: string | null | undefined, pace: Pace | null | undefined, month: string, thisMonth: string): boolean {
  const from = nextDue == null || nextDue < thisMonth ? thisMonth : nextDue.slice(0, 7);
  const gap = monthIndex(month) - monthIndex(from);
  return gap >= 0 && gap % paceMonths(pace) === 0;
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

/** The average rows: one per expense category of the currency with no recurring charge filing to it. */
function averageRows(
  months: ProjectCategoryMonths | null | undefined,
  currency: string,
  recurringCategories: ReadonlySet<string>,
  divisor: number,
): NextMonthRow[] {
  const rows: NextMonthRow[] = [];
  for (const category of months?.categories ?? []) {
    if (category.currency !== currency || (category.id != null && recurringCategories.has(category.id))) continue;
    const total = category.months_minor.reduce((sum, value) => sum + BigInt(value), 0n);
    const average = roundDiv(total, BigInt(divisor));
    // A category whose refunds outweigh its costs has nothing to expect.
    if (average <= 0n) continue;
    rows.push(category.id == null
      ? { key: "avg:none", kind: "average", name: UNCATEGORIZED, date: null, minor: -average }
      : { key: `avg:${category.id}`, kind: "average", name: category.name ?? "", date: null, minor: -average });
  }
  return rows.sort((a, b) => (a.minor === b.minor ? a.name.localeCompare(b.name, "he") : a.minor < b.minor ? -1 : 1));
}

function signedAmount(party: ExpectedParty): bigint {
  const abs = party.typical_amount_minor < 0n ? -party.typical_amount_minor : party.typical_amount_minor;
  return party.direction === "income" ? abs : -abs;
}

/**
 * Next month's rows for one project and currency: the recurring ones by expected day (a loan payment
 * left out), the averages last.
 */
export function nextMonthForecast(input: {
  projectId: string;
  currency: string;
  today: string;
  recurring: readonly ExpectedParty[];
  categoryMonths: ProjectCategoryMonths | null | undefined;
}): NextMonthForecast {
  const month = nextMonthKey(input.today);
  const thisMonth = input.today.slice(0, 7);
  // A loan payment is not a profit line: its category is averaged like any other.
  const charges = input.recurring.filter((party) => party.project_id === input.projectId && party.pays_loan !== true);
  const recurringCategories = new Set(charges.flatMap((party) => (party.category_id == null ? [] : [party.category_id])));
  const recurring = charges
    .filter((party) => party.currency === input.currency && dueInMonth(party.next_due_month, party.pace, month, thisMonth))
    .map((party) => ({
      key: `rec:${party.direction}:${party.party_id}`,
      kind: "recurring" as const,
      name: party.name,
      date: expectedDate(month, party.typical_day),
      minor: signedAmount(party),
    }))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "he") : a.date < b.date ? -1 : 1));
  const divisor = averageMonths(input.categoryMonths);
  const averages = averageRows(input.categoryMonths, input.currency, recurringCategories, divisor);
  const rows: NextMonthRow[] = [...recurring, ...averages];
  const incomeMinor = rows.reduce((sum, row) => (row.minor > 0n ? sum + row.minor : sum), 0n);
  const expenseMinor = rows.reduce((sum, row) => (row.minor < 0n ? sum - row.minor : sum), 0n);
  return {
    month,
    rows,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    recurringCount: recurring.length,
    averageNames: averages.map((row) => row.name),
    averageMonths: divisor,
  };
}

/** The card's third line: what the forecast is made of. */
export function basisLine(recurringCount: number, averageNames: readonly string[]): string {
  const fixed = recurringCount === 1 ? "קבוע אחד" : `${String(recurringCount)} קבועים`;
  const average = averageNames.length === 0
    ? null
    : averageNames.length === 1
      ? `ממוצע ${averageNames[0] ?? ""}`
      : `ממוצע ${String(averageNames.length)} קטגוריות`;
  if (average == null) return fixed;
  return recurringCount === 0 ? average : `${fixed} ו${average}`;
}

/** The project's average monthly share of general expenses: its share for the period over the period's months. */
export function monthlyOverheadShare(share: bigint | null, months: number): bigint | null {
  if (share == null || months <= 0) return null;
  return roundDiv(share, BigInt(months));
}
