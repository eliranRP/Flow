import { formatAmountText, type CashLine } from "@flow/shared";
import { useState } from "react";
import { lineInitials, sideMinor } from "../cash-lines-groups";
import { Amount } from "../ui/amount";
import { formatDayMonth } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";

export type MonthCategory = {
  key: string;
  name: string;
  /** The category's total, positive on its group's side. */
  total: bigint;
  /** Its share of the group's total, a whole percent. */
  share: number;
  /** The bar's width against the group's largest category, a whole percent. */
  width: number;
  /** Newest first. */
  lines: CashLine[];
};

export type MonthCategoryGroup = { key: "in" | "out"; title: "הכנסות" | "הוצאות"; total: bigint; categories: MonthCategory[] };

/** Newest first, then by transaction and part, so ties keep one order. */
function newestFirst(a: CashLine, b: CashLine): number {
  if (a.cash_month_date !== b.cash_month_date) return a.cash_month_date < b.cash_month_date ? 1 : -1;
  if (a.transaction_id !== b.transaction_id) return a.transaction_id < b.transaction_id ? -1 : 1;
  return (a.part ?? "") < (b.part ?? "") ? -1 : (a.part ?? "") > (b.part ?? "") ? 1 : 0;
}

function percent(part: bigint, whole: bigint): number {
  return whole === 0n ? 0 : Math.round((Number(part) * 100) / Number(whole));
}

/**
 * The ProfitMonthCategory frame's groups: income, then expenses, each with one row per category, largest
 * first. A line counts as income when it adds to profit; a group with no lines is left out.
 */
export function monthCategoryGroups(lines: readonly CashLine[]): MonthCategoryGroup[] {
  const sides = [
    { key: "in", title: "הכנסות", rows: lines.filter((line) => sideMinor(line, "kept") > 0n) },
    { key: "out", title: "הוצאות", rows: lines.filter((line) => sideMinor(line, "kept") <= 0n) },
  ] as const;
  return sides.flatMap(({ key, title, rows }) => {
    if (rows.length === 0) return [];
    const signed = (line: CashLine) => (key === "in" ? sideMinor(line, "kept") : -sideMinor(line, "kept"));
    const byName = new Map<string, CashLine[]>();
    for (const line of rows) {
      const name = line.category_name ?? "";
      byName.set(name, [...(byName.get(name) ?? []), line]);
    }
    const total = rows.reduce((sum, line) => sum + signed(line), 0n);
    const sorted = [...byName.entries()]
      .map(([name, members]) => ({ name, members: [...members].sort(newestFirst), sum: members.reduce((sum, line) => sum + signed(line), 0n) }))
      .sort((a, b) => {
        if (a.sum !== b.sum) return b.sum > a.sum ? 1 : -1;
        const [newestA] = a.members;
        const [newestB] = b.members;
        return newestA != null && newestB != null ? newestFirst(newestA, newestB) : 0;
      });
    const largest = sorted[0]?.sum ?? 0n;
    const categories = sorted.map(({ name, members, sum }) => ({
      key: `${key}:${name}`,
      name: name === "" ? "בלי קטגוריה" : name,
      total: sum,
      share: percent(sum, total),
      width: largest <= 0n ? 0 : Math.max(0, percent(sum, largest)),
      lines: members,
    }));
    return [{ key, title, total, categories }];
  });
}

/** "1 תנועה", otherwise "N תנועות". */
function countWord(count: number): string {
  return count === 1 ? "1 תנועה" : `${String(count)} תנועות`;
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

/**
 * The month page's "לפי קטגוריה" view (board frame ProfitMonthCategory): income then expenses, a row per
 * category with its share, count and a bar against the group's largest. A row opens in place to its lines,
 * newest first; one category is open at a time.
 */
export function MonthCategories({ lines, currency, search }: { lines: readonly CashLine[]; currency: string; search: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <>
      {monthCategoryGroups(lines).map((group) => {
        const income = group.key === "in";
        return (
          <section key={group.key} className="ui-lines-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
              <bdi className="t-line2 ui-lines-group-sum" dir="ltr">{`${income ? "+" : ""}${formatAmountText(group.total, currency)}`}</bdi>
            </div>
            <div className="ui-pm-cats">
              {group.categories.map((category) => {
                const open = openKey === category.key;
                return (
                  <div key={category.key} className="ui-pm-cat">
                    <button type="button" className="ui-pm-cat-button" aria-expanded={open} onClick={() => { setOpenKey(open ? null : category.key); }}>
                      <span className="ui-pm-cat-top">
                        <span className="ui-pm-cat-name">{category.name}</span>
                        <Amount agorot={category.total} currency={currency} income={income} />
                      </span>
                      <span className="ui-pm-cat-meta">{`${String(category.share)}% מה${group.title} · ${countWord(category.lines.length)}`}</span>
                      <span className="ui-pm-cat-bar" aria-hidden="true">
                        <span className="ui-pm-cat-bar-fill" style={{ width: `${String(category.width)}%` }} />
                      </span>
                    </button>
                    {open ? (
                      <List layout="flat">
                        {category.lines.map((line) => (
                          <MonthLineRow key={`${line.transaction_id}:${line.part ?? ""}`} line={line} hint={formatDayMonth(line.cash_month_date)} search={search} />
                        ))}
                      </List>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
