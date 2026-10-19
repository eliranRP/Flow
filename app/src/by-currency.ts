import { type CashMonths, type Dashboard, type ProjectDetail, type ProjectRow } from "@flow/shared";

export type ProjectCurrencyRow = {
  currency: string;
  income_minor: bigint;
  direct_minor: bigint;
  shared_minor: bigint;
  profit_minor: bigint;
};

/** The company currency first (0147), then the rest by code. */
function sortCurrency(a: string, b: string, first = "ILS"): number {
  if (a === b) return 0;
  if (a === first) return -1;
  if (b === first) return 1;
  return a.localeCompare(b);
}

function projectBucketAllZero(row: ProjectCurrencyRow): boolean {
  return (
    row.income_minor === 0n
    && row.direct_minor === 0n
    && row.shared_minor === 0n
    && row.profit_minor === 0n
  );
}

function fallbackProjectRow(source: {
  income_agorot: bigint;
  direct_agorot: bigint;
  shared_agorot: bigint;
  profit_agorot: bigint;
}): ProjectCurrencyRow {
  return {
    currency: "ILS",
    income_minor: source.income_agorot,
    direct_minor: source.direct_agorot,
    shared_minor: source.shared_agorot,
    profit_minor: source.profit_agorot,
  };
}

/** A zero row for an empty period in a company whose books are not in shekels. */
function zeroProjectRow(currency: string): ProjectCurrencyRow {
  return { currency, income_minor: 0n, direct_minor: 0n, shared_minor: 0n, profit_minor: 0n };
}

/**
 * The project's figures per currency, the company currency first. An empty period shows one zero row in
 * `emptyCurrency` (the company's currency), so a USD company reads $0, not ₪0.
 */
export function projectRows(project: ProjectRow | NonNullable<ProjectDetail>, emptyCurrency = "ILS"): ProjectCurrencyRow[] {
  const fromPayload = project.by_currency ?? [];
  const base = fromPayload.length > 0
    ? fromPayload.map((row) => ({
      currency: row.currency,
      income_minor: row.income_minor,
      direct_minor: row.direct_minor,
      shared_minor: row.shared_minor,
      profit_minor: row.profit_minor,
    }))
    : [fallbackProjectRow(project)];
  const filtered = base.filter((row) => !projectBucketAllZero(row));
  const empty = emptyCurrency === "ILS" || !projectBucketAllZero(fallbackProjectRow(project))
    ? fallbackProjectRow(project)
    : zeroProjectRow(emptyCurrency);
  const rows = (filtered.length > 0 ? filtered : [empty]).sort((a, b) => sortCurrency(a.currency, b.currency, emptyCurrency));
  return rows;
}

export function projectExpenseMinor(row: ProjectCurrencyRow): bigint {
  const raw = row.direct_minor + row.shared_minor;
  return raw < 0n ? -raw : raw;
}

export function dashboardHasBooks(data: Dashboard): boolean {
  if (data.projects.length > 0) return true;
  if (data.income_agorot !== 0n || data.expense_agorot !== 0n) return true;
  return data.by_currency.some(
    (row) => row.count > 0 || row.income_minor !== 0n || row.expense_minor !== 0n,
  );
}

/**
 * A cash line in Home's recent months proves the books, so Home can draw them before
 * `get_dashboard` answers. No line says nothing: a company may have only older lines or projects.
 */
export function cashHasBooks(data: CashMonths): boolean {
  return (data?.months ?? []).some((month) =>
    month.by_currency.some((row) => row.in_minor !== 0n || row.out_minor !== 0n || row.excluded_count > 0),
  );
}
