import { formatAmountText, type ForecastItem } from "@flow/shared";
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
