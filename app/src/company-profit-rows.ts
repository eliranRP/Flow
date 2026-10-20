import { profitCategoryGroups, type ProfitCategoryGroup } from "./screens/profit-categories";
import { HEBREW_MONTHS } from "./ui/date-math";
import type { ProfitLine, ProfitModel } from "./use-company-profit";

/**
 * The company profit page's rows, pure (board Profit, `co.sum` and `catGroups(L, true)`): the summary card's
 * four rows and the category view's two groups.
 */

/** One summary row: income and expenses positive, the profits signed. */
export type SummaryLine = { id: "income" | "expense" | "profit" | "ytd"; label: string; minor: bigint; strong: boolean };

/**
 * הכנסות, הוצאות שנספרות ברווח, רווח <month> (the row that matters, bold) and רווח מתחילת השנה, once the
 * year to date is read. No share of general expenses: the company is the whole (spec-fcwide, item 0).
 */
export function companySummaryRows(model: Pick<ProfitModel, "income" | "expense" | "profit" | "ytdProfit">, monthKey: string): SummaryLine[] {
  const month = HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey;
  const rows: SummaryLine[] = [
    { id: "income", label: "הכנסות", minor: model.income, strong: false },
    { id: "expense", label: "הוצאות שנספרות ברווח", minor: model.expense, strong: false },
    { id: "profit", label: `רווח ${month}`, minor: model.profit, strong: true },
  ];
  if (model.ytdProfit != null) rows.push({ id: "ytd", label: "רווח מתחילת השנה", minor: model.ytdProfit, strong: false });
  return rows;
}

/** The biggest amount first, by its size (a refund counts by its size too). */
export function bySizeOnly(a: ProfitLine, b: ProfitLine): number {
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const diff = abs(b.amount) - abs(a.amount);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

/** Lines newest first, then the biggest first within a day. */
export function byDateThenSize(a: ProfitLine, b: ProfitLine): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return bySizeOnly(a, b);
}

/**
 * The month's categories as the board's two groups (catGroups with the company's project count): each row's
 * total positive on its side, its line count and projects, and its lines newest first.
 */
export function companyCategoryGroups(model: Pick<ProfitModel, "categories" | "lines">): ProfitCategoryGroup<ProfitLine>[] {
  const inputs = (direction: "income" | "expense") => model.categories
    .filter((row) => row.direction === direction)
    .map((row) => ({
      key: row.key,
      name: row.name,
      total: direction === "income" ? row.amount : -row.amount,
      count: row.count,
      projects: row.projects,
      lines: model.lines.filter((line) => line.direction === direction && line.categoryKey === row.key).sort(byDateThenSize),
    }));
  return profitCategoryGroups(inputs("income"), inputs("expense"));
}
