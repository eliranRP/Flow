import { roundedProfitAgorot, type Dashboard, type ProjectDetail, type ProjectRow } from "@flow/shared";

export type ProjectCurrencyRow = {
  currency: string;
  income_minor: bigint;
  direct_minor: bigint;
  shared_minor: bigint;
  profit_minor: bigint;
};

export type CompanyCurrencyRow = {
  currency: string;
  income_minor: bigint;
  direct_minor: bigint;
  shared_minor: bigint;
  overhead_minor: bigint;
  expense_minor: bigint;
  net_profit_minor: bigint;
  count: number;
};

function sortCurrency(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "ILS") return -1;
  if (b === "ILS") return 1;
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

function companyBucketAllZero(row: CompanyCurrencyRow): boolean {
  return (
    row.income_minor === 0n
    && row.direct_minor === 0n
    && row.shared_minor === 0n
    && row.overhead_minor === 0n
    && row.expense_minor === 0n
    && row.net_profit_minor === 0n
    && row.count === 0
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

function fallbackCompanyRow(source: Dashboard): CompanyCurrencyRow {
  return {
    currency: "ILS",
    income_minor: source.income_agorot,
    direct_minor: source.direct_agorot,
    shared_minor: source.shared_agorot,
    overhead_minor: source.overhead_agorot,
    expense_minor: source.expense_agorot,
    net_profit_minor: source.net_profit_agorot,
    count: 0,
  };
}

export function projectRows(project: ProjectRow | NonNullable<ProjectDetail>): ProjectCurrencyRow[] {
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
  const rows = (filtered.length > 0 ? filtered : [fallbackProjectRow(project)]).sort((a, b) => sortCurrency(a.currency, b.currency));
  return rows;
}

export function companyRows(dashboard: Dashboard): CompanyCurrencyRow[] {
  const fromPayload = dashboard.by_currency;
  const base = fromPayload.length > 0
    ? fromPayload.map((row) => ({ ...row }))
    : [fallbackCompanyRow(dashboard)];
  const filtered = base.filter((row) => !companyBucketAllZero(row));
  const rows = (filtered.length > 0 ? filtered : [fallbackCompanyRow(dashboard)]).sort((a, b) => sortCurrency(a.currency, b.currency));
  return rows;
}

export function primaryCurrency(dashboard: Dashboard): string {
  const rows = companyRows(dashboard);
  let best = rows[0]?.currency ?? "ILS";
  let bestCount = rows[0]?.count ?? 0;
  for (const row of rows) {
    if (row.count > bestCount) {
      best = row.currency;
      bestCount = row.count;
    }
  }
  return best;
}

export function profitInCurrency(project: ProjectRow, currency: string): bigint {
  const row = projectRows(project).find((entry) => entry.currency === currency);
  if (row) return row.profit_minor;
  return currency === "ILS" ? project.profit_agorot : 0n;
}

export function heroLabelProfit(figures: { agorot: bigint }[]): bigint {
  if (figures.length === 0) return 0n;
  const allNonNegative = figures.every((figure) => figure.agorot >= 0n);
  const allNonPositive = figures.every((figure) => figure.agorot <= 0n);
  if (allNonNegative || allNonPositive) {
    return figures.reduce((sum, figure) => sum + figure.agorot, 0n);
  }
  const nonNegative = figures.find((figure) => figure.agorot >= 0n);
  return nonNegative?.agorot ?? 0n;
}

export function roundedHeroProfit(incomeMinor: bigint, expenseMinor: bigint): bigint {
  return roundedProfitAgorot(incomeMinor, expenseMinor);
}

export function projectExpenseMinor(row: ProjectCurrencyRow): bigint {
  const raw = row.direct_minor + row.shared_minor;
  return raw < 0n ? -raw : raw;
}

export function projectAmountFigures(project: ProjectRow): { minor: bigint; currency: string }[] {
  const rows = projectRows(project);
  if (rows.length === 1) {
    const row = rows[0];
    if (row == null) return [];
    return [{ minor: row.profit_minor, currency: row.currency }];
  }
  return rows.map((row) => ({ minor: row.profit_minor, currency: row.currency }));
}

export function projectMarginHint(project: ProjectRow): string | undefined {
  const rows = projectRows(project);
  if (rows.length !== 1) return undefined;
  const row = rows[0];
  if (row == null || row.income_minor <= 0n) return undefined;
  const pct = Number((row.profit_minor * 100n) / row.income_minor);
  const shown = pct < 0 ? `−${String(Math.abs(pct))}%` : `${String(pct)}%`;
  return shown;
}

export function dashboardHasBooks(data: Dashboard): boolean {
  if (data.projects.length > 0) return true;
  if (data.income_agorot !== 0n || data.expense_agorot !== 0n) return true;
  return data.by_currency.some(
    (row) => row.count > 0 || row.income_minor !== 0n || row.expense_minor !== 0n,
  );
}
