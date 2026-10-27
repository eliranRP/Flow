import { formatAmountText, type ForecastItem } from "@flow/shared";
import { Link } from "react-router-dom";
import { chargeHref } from "../recurring-charge";
import { cx } from "../ui/cx";
import { ChevronDownIcon } from "../ui/icons";
import { onRadioArrow } from "../ui/segmented-control";
import { type ForecastCategoryRow, type ForecastCategorySide, itemCharge } from "./forecast-categories";
import { itemLate, itemWhen, signed } from "./forecast-parts";

/** The two views of the forecast (the board's chips): one row per item, or one per category. */
export type ForecastView = "items" | "categories";

const VIEWS: readonly (readonly [ForecastView, string])[] = [
  ["items", "לפי פריט"],
  ["categories", "לפי קטגוריה"],
];

/**
 * The board's chips as a radio group. The keys are SegmentedControl's (roving tabindex, arrows that follow
 * the reading direction, so they reverse under dir=rtl); the look stays the board's chips.
 */
export function ForecastViewSwitch({ view, onPick }: { view: ForecastView; onPick: (view: ForecastView) => void }) {
  return (
    <div className="ui-forecast-views" role="radiogroup" aria-label="תצוגה" onKeyDown={onRadioArrow}>
      {VIEWS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          tabIndex={view === value ? 0 : -1}
          className={cx("ui-forecast-view", view === value && "ui-forecast-view-on")}
          onClick={() => { onPick(value); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency);
}

/** The row's second line: who is late, else so far and still to come. */
function rowMeta(row: ForecastCategoryRow, currency: string): string {
  const ahead = money(row.ahead, currency);
  const first = row.late[0];
  if (first != null) return `${row.late.length === 1 ? first.name : `${String(row.late.length)} פריטים`} באיחור · עוד ${ahead}`;
  const soFar = `עד היום ${money(row.soFar, currency)}`;
  return row.ahead > 0n ? `${soFar} · עוד ${ahead}` : `${soFar} · אין עוד צפוי`;
}

function itemAmount(item: ForecastItem): string {
  return signed(item.minor, item.direction === "income" ? "+" : "−", item.currency);
}

function CategoryRow({
  row,
  income,
  currency,
  today,
  open,
  onToggle,
  onOpenItem,
  search,
}: {
  row: ForecastCategoryRow;
  income: boolean;
  currency: string;
  today: string;
  open: boolean;
  onToggle: () => void;
  onOpenItem: (item: ForecastItem) => void;
  search: string;
}) {
  const hasItems = row.items.length > 0;
  const expanded = open && hasItems;
  const end = money(row.end, currency);
  const top = (
    <>
      <span className="ui-forecast-cat-top">
        <span className="ui-forecast-cat-text">
          <span className="ui-forecast-cat-name">{row.name}</span>
          <span className={cx("ui-forecast-cat-meta", row.late.length > 0 && "ui-forecast-late")}>{rowMeta(row, currency)}</span>
        </span>
        <bdi dir="ltr" className={cx("ui-forecast-cat-end", income && "ui-forecast-income")}>{income ? `+${end}` : end}</bdi>
        <span className={cx("ui-forecast-cat-chev", expanded && "ui-forecast-cat-chev-open")} aria-hidden="true"><ChevronDownIcon size={18} /></span>
      </span>
      <span className="ui-forecast-cat-bar" role="img" aria-label={`עד היום ${money(row.soFar, currency)}, צפוי עוד ${money(row.ahead, currency)}`}>
        <span className="ui-forecast-cat-bar-so-far" style={{ flexGrow: Number(row.soFar) || 0.0001 }} />
        <span className="ui-forecast-cat-bar-ahead" style={{ flexGrow: Number(row.ahead) || 0.0001 }} />
      </span>
    </>
  );
  return (
    <li className="ui-forecast-cat-li">
      {hasItems ? (
        <button type="button" className="ui-forecast-cat-row" aria-expanded={expanded} onClick={onToggle}>{top}</button>
      ) : (
        // No items to open: the same row, not a control (its chevron keeps its place, hidden).
        <div className="ui-forecast-cat-row ui-forecast-cat-row-still">{top}</div>
      )}
      {expanded ? (
        <ul className="ui-forecast-cat-kids">
          <li className="ui-forecast-cat-so-far">
            <span>עד היום</span>
            <bdi dir="ltr">{money(row.soFar, currency)}</bdi>
          </li>
          {row.items.map((item) => {
            const late = itemLate(item, today);
            const charge = late ? itemCharge(item) : null;
            return (
              <li key={item.key} className="ui-forecast-cat-kid-li">
                <button type="button" className="ui-forecast-cat-kid" data-forecast-key={item.key} onClick={() => { onOpenItem(item); }} aria-label={`${item.name}, ${itemAmount(item)}`}>
                  <span className="ui-forecast-cat-kid-text">
                    <span className="ui-forecast-cat-kid-name">{item.name}</span>
                    <span className={cx("ui-forecast-cat-kid-when", late && "ui-forecast-late")}>{itemWhen(item, today)}</span>
                  </span>
                  <bdi dir="ltr" className="ui-forecast-cat-kid-amount">{itemAmount(item)}</bdi>
                </button>
                {charge == null ? null : (
                  <Link className="ui-forecast-cat-ask" to={chargeHref(charge.direction, charge.partyId, search, charge.projectId)}>עדיין קבוע? לאישור ←</Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/** לפי קטגוריה: out, then in; each category's month so far and still to come, a tap opens its items. */
export function ForecastCategoryView({
  sides,
  currency,
  today,
  open,
  onToggle,
  onOpenItem,
  search = "",
}: {
  sides: readonly ForecastCategorySide[];
  currency: string;
  today: string;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onOpenItem: (item: ForecastItem) => void;
  search?: string;
}) {
  return (
    <>
      {sides.map((side) => {
        const income = side.direction === "income";
        const total = money(side.total, currency);
        return (
          <section key={side.direction} className="ui-forecast-section ui-forecast-cat-section" aria-label={income ? "נכנס" : "יוצא"}>
            <h2 className="ui-forecast-section-head ui-forecast-cat-head">
              <span>{income ? "נכנס" : "יוצא"}</span>
              <span className="ui-forecast-cat-sum">בסוף החודש <bdi dir="ltr" className={cx(income && "ui-forecast-income")}>{income ? `+${total}` : total}</bdi></span>
            </h2>
            <ul className="ui-forecast-list">
              {side.rows.map((row) => {
                const key = `${side.direction}:${row.key}`;
                return (
                  <CategoryRow
                    key={key}
                    row={row}
                    income={income}
                    currency={currency}
                    today={today}
                    open={open.has(key)}
                    onToggle={() => { onToggle(key); }}
                    onOpenItem={onOpenItem}
                    search={search}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className="ui-forecast-legend">
        <span><span className="ui-forecast-dot ui-forecast-dot-so-far" aria-hidden="true" />עד היום</span>
        <span><span className="ui-forecast-dot ui-forecast-dot-ahead" aria-hidden="true" />צפוי עד סוף החודש</span>
      </p>
      <p className="ui-forecast-foot">עד היום לפי הקטגוריות שנספרות ברווח, לפני מע״מ. העברות וקרן הלוואות לא נכללות.</p>
    </>
  );
}
