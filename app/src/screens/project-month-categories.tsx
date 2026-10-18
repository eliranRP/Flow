import type { CashLine } from "@flow/shared";
import { lineInitials, sideMinor } from "../cash-lines-groups";
import { formatDayMonth } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { ListRow } from "../ui/list-row";
import { ProfitCategories, profitCategoryGroups, type ProfitCategoryGroup, type ProfitCategoryInput } from "./profit-categories";

/** Newest first, then by transaction and part, so ties keep one order. */
function newestFirst(a: CashLine, b: CashLine): number {
  if (a.cash_month_date !== b.cash_month_date) return a.cash_month_date < b.cash_month_date ? 1 : -1;
  if (a.transaction_id !== b.transaction_id) return a.transaction_id < b.transaction_id ? -1 : 1;
  return (a.part ?? "") < (b.part ?? "") ? -1 : (a.part ?? "") > (b.part ?? "") ? 1 : 0;
}

/** One side's categories: a line's amount counts positive on the side it adds to. */
function categoriesOf(lines: readonly CashLine[], income: boolean): ProfitCategoryInput<CashLine>[] {
  const byName = new Map<string, CashLine[]>();
  for (const line of lines) {
    const name = line.category_name ?? "";
    byName.set(name, [...(byName.get(name) ?? []), line]);
  }
  return [...byName.entries()].map(([name, members]) => ({
    key: name,
    name: name === "" ? "בלי קטגוריה" : name,
    total: members.reduce((sum, line) => sum + (income ? sideMinor(line, "kept") : -sideMinor(line, "kept")), 0n),
    count: members.length,
    lines: [...members].sort(newestFirst),
  }));
}

/** The month's counted lines as the category groups: a line is income when it adds to profit. */
export function monthCategoryGroups(lines: readonly CashLine[]): ProfitCategoryGroup<CashLine>[] {
  return profitCategoryGroups(
    categoriesOf(lines.filter((line) => sideMinor(line, "kept") > 0n), true),
    categoriesOf(lines.filter((line) => sideMinor(line, "kept") <= 0n), false),
  );
}

/** One counted line of the month page, as the by-date view draws it; the hint is the caller's. */
export function MonthLineRow({ line, hint, search }: { line: CashLine; hint: string; search: string }) {
  const name = line.supplier_name ?? line.description;
  const minor = sideMinor(line, "kept");
  return (
    <ListRow
      layout="flat"
      variant="transaction"
      title={name}
      hint={hint}
      agorot={minor < 0n ? -minor : minor}
      currency={line.currency}
      sign={line.side}
      wholeCents
      source={rowSource(line.source)}
      initials={lineInitials(name)}
      href={`/transactions/${line.transaction_id}${search}`}
    />
  );
}

/** The month page's "לפי קטגוריה" view (board frame ProfitMonthCategory); an opened line's hint is its day. */
export function MonthCategories({ lines, currency, search }: { lines: readonly CashLine[]; currency: string; search: string }) {
  return (
    <ProfitCategories
      groups={monthCategoryGroups(lines)}
      currency={currency}
      renderLine={(line) => <MonthLineRow key={`${line.transaction_id}:${line.part ?? ""}`} line={line} hint={formatDayMonth(line.cash_month_date)} search={search} />}
    />
  );
}
