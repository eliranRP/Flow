import { formatAmountText } from "@flow/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Amount } from "../ui/amount";
import { List } from "../ui/list-row";
import { LineRowSkeleton } from "../ui/screen-skeletons";

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

/** FLOW-954. A kept-out category (לא נספר ברווח): its name, its account type, its total and meta line, and its lines. */
export type KeptOutCategory<L> = {
  key: string;
  name: string;
  /** נכס or התחייבות. */
  type: string;
  /** Positive on its side. */
  total: bigint;
  /** Money in that is not income: "+" in the text colour, never green. */
  moneyIn: boolean;
  meta: string;
  lines: readonly L[];
};

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

/** FLOW-1194. How far before the viewport a row counts as near: its lines are read about a screen ahead of the scroll. */
const NEAR_MARGIN = "400px 0px";

/** A category's box. Once it is near the viewport it asks, one time, for its lines (`onWant` with its key); the caller reads them. */
function CategoryBox({ className, rowKey, onWant, children }: { className: string; rowKey: string; onWant: ((key: string) => void) | undefined; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (node == null || onWant == null || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      onWant(rowKey);
    }, { rootMargin: NEAR_MARGIN });
    watch.observe(node);
    return () => { watch.disconnect(); };
  }, [onWant, rowKey]);
  return <div ref={box} className={className}>{children}</div>;
}

/**
 * The category view of a profit page (board frames ProfitMonthCategory and ProfitByCategory): a head per
 * group with its total, a row per category with its share, count (and projects when above one), total and a
 * bar. A row opens in place to its lines, drawn by the caller; one category is open at a time.
 */
export function ProfitCategories<L>({ groups, keptOut = [], currency, renderLine, initialOpen = null, onWant, linesLoading }: {
  groups: readonly ProfitCategoryGroup<L>[];
  /** FLOW-954 (board LedgerBreakdownKeptOut): the kept-out categories, a group of their own after the counted ones. */
  keptOut?: readonly KeptOutCategory<L>[];
  currency: string;
  renderLine: (line: L) => ReactNode;
  initialOpen?: string | null;
  /**
   * FLOW-1194: called with a row's key when the row scrolls near the viewport, and when it is tapped; the caller reads
   * that category's lines (a repeat is its to ignore). Without it the lines come with the rows.
   */
  onWant?: (key: string) => void;
  /** True while an open row's lines are being read: a skeleton row stands in for them. */
  linesLoading?: (key: string) => boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpen);
  const toggle = (key: string, shown: boolean) => {
    if (!shown) onWant?.(key);
    setOpenKey(shown ? null : key);
  };
  const linesOf = (key: string, lines: readonly L[]) => (linesLoading?.(key) === true ? <LineRowSkeleton /> : <List layout="flat">{lines.map(renderLine)}</List>);
  const keptOutGroup = keptOut.length === 0 ? null : (
    <section className="ui-lines-group ui-pcat-group" aria-label="לא נספר ברווח">
      <div className="ui-lines-group-head">
        <h2 className="t-section ui-lines-group-title">לא נספר ברווח</h2>
        <span className="t-line2 t-muted">{keptOut.length === 1 ? "קטגוריה אחת" : `${String(keptOut.length)} קטגוריות`}</span>
      </div>
      <div className="ui-pcat-list">
        {keptOut.map((category) => {
          const open = openKey === category.key;
          return (
            <CategoryBox key={category.key} rowKey={category.key} className="ui-pcat ui-pcat-kept" onWant={onWant}>
              <button type="button" className="ui-pcat-button" aria-expanded={open} onClick={() => { toggle(category.key, open); }}>
                <span className="ui-pcat-top">
                  <span className="ui-pcat-name">
                    <span className="ui-pcat-kept-name">{category.name}</span>
                    <span className="ui-pcat-kept-type">{` · ${category.type}`}</span>
                  </span>
                  <Amount agorot={category.total} currency={currency} direction={category.moneyIn ? "income" : undefined} />
                </span>
                <span className="ui-pcat-meta">{category.meta}</span>
              </button>
              {open ? linesOf(category.key, category.lines) : null}
            </CategoryBox>
          );
        })}
      </div>
    </section>
  );
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
                  <CategoryBox key={category.key} rowKey={category.key} className="ui-pcat" onWant={onWant}>
                    <button type="button" className="ui-pcat-button" aria-expanded={open} onClick={() => { toggle(category.key, open); }}>
                      <span className="ui-pcat-top">
                        <span className="ui-pcat-name">{category.name}</span>
                        <Amount agorot={category.total} currency={currency} income={income} />
                      </span>
                      <span className="ui-pcat-meta">{`${String(category.share)}% מה${group.title} · ${countWord(category.count)}${projects}`}</span>
                      <span className="ui-pcat-bar" aria-hidden="true">
                        <span className="ui-pcat-bar-fill" style={{ width: `${String(category.width)}%` }} />
                      </span>
                    </button>
                    {open ? linesOf(category.key, category.lines) : null}
                  </CategoryBox>
                );
              })}
            </div>
          </section>
        );
      })}
      {keptOutGroup}
    </>
  );
}
