import { formatAmountText, type ForecastItem } from "@flow/shared";
import { weekEndDay } from "../forecast-month";
import { Amount } from "../ui/amount";
import { cx } from "../ui/cx";
import { SwipeRow } from "../ui/swipe-row";
import type { ReactNode } from "react";

/** The screen's name: its header, the compact bar and the item page's back link (canvas note spec-cash2). */
export const FORECAST_TITLE = "תזרים צפוי";

/** A signed amount in the base's currency: the sign, then the figure without its own minus. */
export function signed(minor: bigint, sign: "+" | "−" | "", currency: string): string {
  const text = formatAmountText(minor < 0n ? -minor : minor, currency);
  return `${sign}${text}`;
}

/** The reset line under the header (FLOW-141b): 36px high always; hidden, not removed, when nothing changed. */
export function ChangedLine({ changed, onReset }: { changed: number; onReset: () => void }) {
  const text = changed === 0 ? "הצפי לפי Flow" : changed === 1 ? "שינית פריט אחד בצפי" : `שינית ${String(changed)} פריטים בצפי`;
  return (
    <div className={cx("ui-forecast-changed", changed > 0 && "ui-forecast-changed-on")} aria-hidden={changed === 0}>
      <span>{text}</span>
      <button type="button" className="ui-forecast-reset" onClick={onReset} disabled={changed === 0}>איפוס</button>
    </div>
  );
}

/**
 * An item taken out of the month (FLOW-1081: "הוצא מהצפי"): the name and "לא צפוי ב<month>" (an invoice: moved to
 * next month), and the signed amount, muted and crossed out. It swipes back ("החזרה לצפי") when `onRestore` is given.
 */
export function MovedRow({ item, monthLabel, onOpen, onRestore }: {
  item: ForecastItem;
  monthLabel: string;
  onOpen: (item: ForecastItem) => void;
  onRestore?: (item: ForecastItem) => void;
}) {
  const name = item.name === "" ? "ללא שם" : item.name;
  const amount = signed(item.minor, item.direction === "income" ? "+" : "−", item.currency);
  const status = item.kind === "invoice" ? "הועבר לחודש הבא" : `לא צפוי ב${monthLabel}`;
  const row = (
    <button type="button" className="ui-forecast-moved-row" data-forecast-key={item.key} onClick={() => { onOpen(item); }} aria-label={`${name}, ${amount}, ${status}`}>
      <span className="ui-forecast-moved-text">
        <span className="ui-forecast-moved-name">{name}</span>
        <span className="ui-forecast-moved-status">{status}</span>
      </span>
      <bdi dir="ltr">{amount}</bdi>
    </button>
  );
  return (
    <li className="ui-forecast-moved-li">
      {onRestore == null ? row : <SwipeRow label="החזרה לצפי" onRemove={() => { onRestore(item); }}>{row}</SwipeRow>}
    </li>
  );
}

/** The one line that says what the forecast counts; it links to nothing. */
export function ForecastFootnote() {
  return (
    <p className="ui-forecast-foot">
      הקישו על פריט כדי לשנות סכום או מועד. השינוי משנה רק את הצפי. לפי חיובים קבועים, חשבוניות פתוחות של לקוחות וספקים ותשלומי הלוואות.
    </p>
  );
}

/** `yyyy-mm-dd` as the board writes a day: 22/10. */
export function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Late and not moved by the owner (or moved to this week): Flow expects it this week. */
export function itemLate(item: ForecastItem, today: string): boolean {
  return item.late_days > 0 && (item.due_on == null || item.due_on === weekEndDay(today));
}

/** FLOW-1013: a line the owner added to a project's forecast, named as a thing, like "קבוע" and "חשבונית". */
export const ADDED_LINE = "שורה בצפי";

/** What the item is: "חשבונית #1043", "חשבון ספק #VD-118", "קבוע" or "שורה בצפי". */
export function itemWhat(item: ForecastItem): string {
  if (item.kind === "added") return ADDED_LINE;
  if (item.kind !== "invoice") return "קבוע";
  const label = item.direction === "income" ? "חשבונית" : "חשבון ספק";
  const number = item.description?.replace(/^(Invoice|Bill)\s*/i, "") ?? "";
  if (number === "") return label;
  return `${label} ${number.startsWith("#") ? number : `#${number}`}`;
}

/** The row's second half: late and expected this week, a day the owner set, or Flow's own date. */
export function itemWhen(item: ForecastItem, today: string): string {
  if (itemLate(item, today)) return "באיחור · צפוי השבוע";
  if (item.due_on != null) return item.due_on === weekEndDay(today) ? "השבוע" : `עד ${dayMonth(item.due_on)}`;
  if (item.expected_on != null) return `עד ${dayMonth(item.expected_on)}`;
  if (item.kind === "invoice") return item.direction === "income" ? "לגבייה" : "לתשלום";
  return item.day != null ? `ב־${String(item.day)}` : "השבוע";
}

/**
 * One item's row: its name, when and what (FLOW-1013: the date first, so 320 never cuts it), and its amount; a tap opens
 * its page. FLOW-1081: with `onSkip`, it swipes to "לא החודש", out of this month's forecast (the item page's own choice).
 */
export function ForecastRowButton({ item, today, onOpen, leaving, onSkip }: {
  item: ForecastItem;
  today: string;
  onOpen: (item: ForecastItem) => void;
  leaving: boolean;
  onSkip?: (item: ForecastItem) => void;
}) {
  const name = item.name === "" ? "ללא שם" : item.name;
  const amount = item.direction === "income" ? signed(item.minor, "+", item.currency) : signed(item.minor, "−", item.currency);
  const figure = <Amount agorot={item.minor} size="list" currency={item.currency} direction={item.direction} income={item.direction === "income"} />;
  return (
    <li className={cx("ui-forecast-li", leaving && "ui-forecast-leaving")}>
      <SwipeOut onSkip={onSkip == null ? null : () => { onSkip(item); }}>
      <button type="button" className="ui-forecast-row" data-forecast-key={item.key} onClick={() => { onOpen(item); }} aria-label={`${name}, ${amount}`}>
        <span className="ui-forecast-initial" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="ui-forecast-text">
          <span className="ui-forecast-name">{name}</span>
          <span className="ui-forecast-meta">{`${itemWhen(item, today)} · ${itemWhat(item)}`}</span>
        </span>
        <span className={cx("ui-forecast-amount", item.overridden && "ui-forecast-edited")}>{figure}</span>
      </button>
      </SwipeOut>
    </li>
  );
}

/** The row in its swipe, or alone (a viewer, the small charges' own rows). */
function SwipeOut({ onSkip, children }: { onSkip: (() => void) | null; children: ReactNode }) {
  if (onSkip == null) return <>{children}</>;
  return <SwipeRow label="לא החודש" onRemove={onSkip}>{children}</SwipeRow>;
}
