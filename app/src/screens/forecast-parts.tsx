import { formatAmountText, type ForecastItem } from "@flow/shared";
import { weekEndDay } from "../forecast-month";
import { cx } from "../ui/cx";

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

/** An item moved to next month: one line, the name at the start and the signed amount at the end, muted. */
export function MovedRow({ item, onOpen }: { item: ForecastItem; onOpen: (item: ForecastItem) => void }) {
  const name = item.name === "" ? "ללא שם" : item.name;
  const amount = signed(item.minor, item.direction === "income" ? "+" : "−", item.currency);
  return (
    <li className="ui-forecast-moved-li">
      <button type="button" className="ui-forecast-moved-row" onClick={() => { onOpen(item); }} aria-label={`${name}, ${amount}`}>
        <span>{name}</span>
        <bdi dir="ltr">{amount}</bdi>
      </button>
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

/** The row's first words: "חשבונית #1043", "חשבון ספק #VD-118" or "קבוע". */
export function itemWhat(item: ForecastItem): string {
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
  return item.expected_on != null ? `עד ${dayMonth(item.expected_on)}` : "עד סוף החודש";
}
