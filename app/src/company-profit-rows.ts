import { countWord, profitCategoryGroups, type KeptOutCategory, type ProfitCategoryGroup } from "./screens/profit-categories";
import { HEBREW_MONTHS } from "./ui/date-math";
import type { ProfitLine, ProfitModel } from "./use-company-profit";

/**
 * The company profit page's rows, pure (board Profit, `co.sum` and `catGroups(L, true)`): the summary card's
 * four rows and the category view's two groups.
 */

/** One summary row: income and expenses positive, the profits signed. */
/** `compare` is the year view's year before, or since the start's most profitable year: signed, as a profit. */
export type SummaryLine = { id: "income" | "expense" | "profit" | "ytd" | "compare"; label: string; minor: bigint; strong: boolean };

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

/**
 * FLOW-954. The ledger account type a kept-out category's lines land on, in the drill-down's words: a loan's
 * principal is a liability (התחייבות) and escrow an asset (נכס), as the ledger books them (decision 0208);
 * any other kept-out category is money in that is owed (a loan received, owner money: התחייבות) or money out
 * that is held (a purchase: נכס).
 */
export function keptOutTypeLabel(direction: "income" | "expense", loanPart: string | null): string {
  if (loanPart === "principal") return "התחייבות";
  if (loanPart === "escrow") return "נכס";
  return direction === "income" ? "התחייבות" : "נכס";
}

/**
 * FLOW-954 (board LedgerBreakdownKeptOut). The category view's לא נספר ברווח group: each kept-out category,
 * largest first, named with its account type, its count and its project (or how many), and its lines.
 */
export function companyKeptOutCategories(model: Pick<ProfitModel, "keptOut" | "keptOutLines">): KeptOutCategory<ProfitLine>[] {
  return model.keptOut.map((row) => {
    const lines = model.keptOutLines.filter((line) => line.direction === row.direction && line.categoryKey === row.key).sort(byDateThenSize);
    const project = row.projects > 1 ? `${String(row.projects)} פרויקטים` : (lines.find((line) => line.project != null)?.project ?? null);
    return {
      key: `kept:${row.direction}:${row.key}`,
      name: row.name,
      type: keptOutTypeLabel(row.direction, row.loanPart),
      total: row.total,
      moneyIn: row.direction === "income",
      meta: [countWord(row.count), project].filter(Boolean).join(" · "),
      lines,
    };
  });
}
