import { formatAmountText } from "@flow/shared";
import { useState, type ReactNode } from "react";
import { Amount } from "../ui/amount";
import { List } from "../ui/list-row";

/** One category of a group as the caller counts it: `total` is positive on the group's side. */
export type ProfitCategoryInput<L> = {
  key: string;
  name: string;
  total: bigint;
  /** Its number of lines. */
  count: number;
  /** How many projects its lines span; the meta line names it only above one. */
  projects?: number;
  /** Newest first. */
  lines: readonly L[];
};

export type ProfitCategory<L> = ProfitCategoryInput<L> & {
  /** Its share of the group's total, a whole percent. */
  share: number;
  /** The bar's width against the group's largest category, a whole percent. */
  width: number;
};

export type ProfitCategoryGroup<L> = { key: "in" | "out"; title: "הכנסות" | "הוצאות"; total: bigint; categories: ProfitCategory<L>[] };

function percent(part: bigint, whole: bigint): number {
  return whole <= 0n || part <= 0n ? 0 : Math.round((Number(part) * 100) / Number(whole));
}

/**
 * The board's category groups (catGroups): income, then expenses, each with its categories largest first
 * (a tie by name), their shares of the group and their bars against its largest. An empty group is left out.
 */
export function profitCategoryGroups<L>(income: readonly ProfitCategoryInput<L>[], expense: readonly ProfitCategoryInput<L>[]): ProfitCategoryGroup<L>[] {
  const sides = [
    { key: "in", title: "הכנסות", inputs: income },
    { key: "out", title: "הוצאות", inputs: expense },
  ] as const;
  return sides.flatMap(({ key, title, inputs }) => {
    if (inputs.length === 0) return [];
    const sorted = [...inputs].sort((a, b) => (a.total !== b.total ? (b.total > a.total ? 1 : -1) : a.name.localeCompare(b.name)));
    const total = sorted.reduce((sum, category) => sum + category.total, 0n);
    const largest = sorted[0]?.total ?? 0n;
    const categories = sorted.map((category) => ({
      ...category,
      key: `${key}:${category.key}`,
      share: percent(category.total, total),
      width: percent(category.total, largest),
    }));
    return [{ key, title, total, categories }];
  });
}

/** "1 תנועה", otherwise "N תנועות". */
export function countWord(count: number): string {
  return count === 1 ? "1 תנועה" : `${String(count)} תנועות`;
}

/**
 * The category view of a profit page (board frames ProfitMonthCategory and ProfitByCategory): a head per
 * group with its total, a row per category with its share, count (and projects when above one), total and a
 * bar. A row opens in place to its lines, drawn by the caller; one category is open at a time.
 */
export function ProfitCategories<L>({ groups, currency, renderLine, initialOpen = null }: {
  groups: readonly ProfitCategoryGroup<L>[];
  currency: string;
  renderLine: (line: L) => ReactNode;
  initialOpen?: string | null;
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpen);
  return (
    <>
      {groups.map((group) => {
        const income = group.key === "in";
        return (
          <section key={group.key} className="ui-lines-group ui-pcat-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
              <bdi className="t-line2 ui-lines-group-sum" dir="ltr">{`${income ? "+" : ""}${formatAmountText(group.total, currency)}`}</bdi>
            </div>
            <div className="ui-pcat-list">
              {group.categories.map((category) => {
                const open = openKey === category.key;
                const projects = (category.projects ?? 1) > 1 ? ` · ${String(category.projects)} פרויקטים` : "";
                return (
                  <div key={category.key} className="ui-pcat">
                    <button type="button" className="ui-pcat-button" aria-expanded={open} onClick={() => { setOpenKey(open ? null : category.key); }}>
                      <span className="ui-pcat-top">
                        <span className="ui-pcat-name">{category.name}</span>
                        <Amount agorot={category.total} currency={currency} income={income} />
                      </span>
                      <span className="ui-pcat-meta">{`${String(category.share)}% מה${group.title} · ${countWord(category.count)}${projects}`}</span>
                      <span className="ui-pcat-bar" aria-hidden="true">
                        <span className="ui-pcat-bar-fill" style={{ width: `${String(category.width)}%` }} />
                      </span>
                    </button>
                    {open ? <List layout="flat">{category.lines.map(renderLine)}</List> : null}
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
