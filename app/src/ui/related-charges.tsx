import { formatAmountText, type PartyCharges } from "@flow/shared";
import { type RefObject } from "react";
import { Link } from "react-router-dom";
import { absAgorot } from "../agorot";
import { chargeMark, chargesTitle, earlierCharges, partyChangeView, shortMonth, type PartyChangeView } from "../party-charges";
import { cx } from "./cx";
import { formatDayMonth, formatDisplay } from "./date-math";
import { ChevronIcon } from "./icons";
import { Sheet } from "./sheet";
import "./css/38-related-charges.css";

/**
 * FLOW-431 and FLOW-366: a party's charges under the recurring row. The history block shows the usual
 * amount and the change, six month bars (this month's accent), the three latest earlier charges and
 * "לכל החיובים"; the sheet lists the twelve newest with their ▲/▼ marks against the usual amount.
 */

/**
 * Charges, newest first; each other line opens its own screen, this one is marked. The charge page's
 * history (`plain`) marks no line and has no chevron: every row is a plain link to its transaction.
 */
function ChargeRows({
  data,
  charges,
  search,
  typical,
  chevron = true,
  plain = false,
  longDate = false,
}: {
  data: PartyCharges;
  charges: PartyCharges["charges"];
  search: string;
  /** Shows the ±20% mark on each row against the usual amount (the sheet). */
  typical?: bigint | null;
  /** The board's all-charges list has no chevron on its rows; the page's history keeps it. */
  chevron?: boolean;
  plain?: boolean;
  /** The sheet writes every date with its year (11/09/26); the card under the row keeps day and month. */
  longDate?: boolean;
}) {
  const currency = data.party?.currency ?? "ILS";
  const income = data.party?.direction === "income";
  return (
    <ul className="ui-charges-list">
      {charges.map((charge) => {
        const current = !plain && charge.id === data.transaction_id;
        const amount = formatAmountText(absAgorot(charge.amount_minor), currency, { detail: true });
        const date = longDate ? formatDisplay(charge.doc_date).replace(/\/\d{2}(\d{2})$/, "/$1") : formatDayMonth(charge.doc_date);
        const mark = typical == null ? null : chargeMark(charge.amount_minor, typical, income);
        const name = `${date}, ${amount}${current ? ", השורה הזו" : ""}`;
        const body = (
          <>
            <span className="ui-charges-date">
              <bdi dir="ltr">{date}</bdi>
              {current ? <span className="ui-charges-badge">השורה הזו</span> : null}
            </span>
            {mark == null ? null : (
              <span className={cx("ui-charges-mark", mark.hurts ? "ui-delta-bad" : "ui-delta-flat")}>
                {mark.arrow} <bdi dir="ltr">{mark.percent}</bdi>
              </span>
            )}
            <span className="ui-charges-end">
              <bdi dir="ltr" className={cx("ui-charges-amount", income && "ui-charges-income")}>{income ? `+${amount}` : amount}</bdi>
              {current || !chevron || plain ? null : <ChevronIcon />}
            </span>
          </>
        );
        return (
          <li key={charge.id}>
            {current ? (
              <div className="ui-charges-row ui-charges-row-now" aria-label={name} aria-current="true">{body}</div>
            ) : (
              <Link to={`/transactions/${charge.id}${search}`} className="ui-charges-row ui-hit" aria-label={name}>{body}</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "בדרך כלל $11.99 · עלה ב־92%": the signal colour only when the change hurts. */
function ChangeLine({ view }: { view: PartyChangeView }) {
  return (
    <p className="ui-charges-line">
      <span className="ui-charges-usual">בדרך כלל <bdi dir="ltr">{view.usual}</bdi></span>
      {" · "}
      <span className={cx("ui-charges-change", view.hurts && view.percent != null && "ui-charges-change-bad")}>{view.change}</span>
    </p>
  );
}

/**
 * FLOW-963: the charge page's head says what the bars show. The metric is a small label, then the
 * takeaway ("גבוה ב־38% מהרגיל", "כמו בכל חודש"), in the signal colour only when the change hurts, then
 * the usual amount (data-viz § 9).
 */
function PlainHead({ title, view }: { title: string; view: PartyChangeView | null }) {
  return (
    <div className="ui-charges-head">
      <h2 className="ui-charges-metric">{title}</h2>
      {view?.takeaway == null ? null : (
        <p className={cx("ui-charges-takeaway", view.hurts && view.percent != null && "ui-charges-takeaway-bad")}>{view.takeaway}</p>
      )}
      {view == null ? null : (
        <p className="ui-charges-usual-line">
          בדרך כלל <bdi dir="ltr">{view.usual}</bdi>
        </p>
      )}
    </div>
  );
}

/** "חיובים ב־6 החודשים האחרונים: מאי $98, יוני $104, יולי אין, …": every month, for screen readers. */
function barsLabel(data: PartyCharges, months: PartyCharges["months"]): string {
  const currency = data.party?.currency ?? "ILS";
  const what = data.party?.direction === "income" ? "תקבולים" : "חיובים";
  const name = new Intl.DateTimeFormat("he-IL", { month: "long", timeZone: "UTC" });
  const each = months.map((month) => {
    const size = absAgorot(month.amount_minor);
    return `${name.format(new Date(`${month.month}-15T12:00:00Z`))} ${size === 0n ? "אין" : formatAmountText(size, currency)}`;
  });
  return `${what} ב־${String(months.length)} החודשים האחרונים: ${each.join(", ")}`;
}

/**
 * The history block under the recurring row: the title, the usual amount and the change, six
 * month bars, the three latest earlier charges and the link to all of them. Nothing shows with
 * fewer than 2 earlier charges, or without a party.
 * `plain` (the charge page, FLOW-447c) lists the three newest of all charges, this one included, and
 * takes its change line and six months from the page (`change`, `months`).
 */
export function PartyChargesHistory({
  data,
  search = "",
  onShowAll,
  showAllRef,
  plain = false,
  change = null,
  months,
}: {
  data: PartyCharges;
  search?: string;
  onShowAll: () => void;
  showAllRef?: RefObject<HTMLButtonElement | null>;
  plain?: boolean;
  /** The plain history's change line; null draws none. */
  change?: PartyChangeView | null;
  /** The plain history's six months, when the page pads them. */
  months?: PartyCharges["months"];
}) {
  const list = plain ? data.charges : earlierCharges(data);
  if (data.party == null || list.length < 2) return null;
  const view = plain ? change : partyChangeView(data);
  const shown = months ?? data.months;
  return (
    <section className="ui-charges-history">
      {plain ? (
        <PlainHead title={chargesTitle(data)} view={view} />
      ) : (
        <>
          <h2 className="ui-charges-title">{chargesTitle(data)}</h2>
          {view == null ? null : <ChangeLine view={view} />}
        </>
      )}
      <ChargeMonthBars months={shown} plain={plain} label={plain ? barsLabel(data, shown) : undefined} />
      <ChargeRows data={data} charges={list.slice(0, 3)} search={search} plain={plain} />
      {list.length > 3 ? (
        <button ref={showAllRef} type="button" className="ui-charges-all ui-hit" aria-haspopup="dialog" onClick={onShowAll}>
          לכל ה{data.party.direction === "income" ? "תקבולים" : "חיובים"}
          {plain ? null : <ChevronIcon />}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Six month bars in px: the oldest on the right, this month accent, the rest tint. No axis, no figures.
 * A month with no charge is a 3px line (the empty bar); the page's bars carry the month number, the
 * transaction page's the month's name. FLOW-963: the charge page's bars (`plain`) are grey at 3:1, the
 * empty month a 2px line, and the chart is one image whose label names every month.
 */
export function ChargeMonthBars({ months, plain = false, label }: { months: PartyCharges["months"]; plain?: boolean; label?: string }) {
  const sizes = months.map((month) => absAgorot(month.amount_minor));
  const top = sizes.reduce((max, size) => (size > max ? size : max), 0n);
  return (
    <div
      className={cx("ui-charge-bars", plain && "ui-charge-bars-plain")}
      {...(label == null ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      {months.map((month, index) => {
        const size = sizes[index] ?? 0n;
        // 10px for the smallest charge, 56px for the biggest: the board's 10 + 46 · v / max.
        const empty = size === 0n;
        const height = empty ? (plain ? 2 : 3) : 10 + Math.round((46 * Number(size)) / Number(top));
        const current = index === months.length - 1;
        return (
          <div key={month.month} className="ui-charge-bar-col">
            <div className="ui-charge-bar-track">
              <div
                className={cx("ui-charge-bar", current && "ui-charge-bar-now", empty && "ui-charge-bar-empty")}
                style={{ blockSize: `${String(height)}px` }}
              />
            </div>
            <span className={cx("ui-charge-bar-label", current && "ui-charge-bar-label-now")}>
              {plain ? month.month.slice(5, 7) : shortMonth(month.month)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The sheet's body, as the board draws it: the summary box, then the twelve newest charges with their marks. */
export function PartyChargesBody({ data, search = "" }: { data: PartyCharges; search?: string }) {
  const currency = data.party?.currency ?? "ILS";
  const usual = data.typical_amount_minor == null ? null : formatAmountText(absAgorot(data.typical_amount_minor), currency, { detail: true });
  const total = data.charges.reduce((sum, charge) => sum + absAgorot(charge.amount_minor), 0n);
  return (
    <div className="ui-charges">
      <div className="ui-charges-summary">
        {usual == null ? <span /> : <span>בדרך כלל <bdi dir="ltr">{usual}</bdi></span>}
        <span>
          {`${String(data.charges.length)} האחרונים · `}
          <bdi dir="ltr">{formatAmountText(total, currency, { detail: true })}</bdi>
        </span>
      </div>
      <ChargeRows data={data} charges={data.charges} search={search} typical={data.typical_amount_minor} chevron={false} longDate />
    </div>
  );
}

export function PartyChargesSheet({
  open,
  onOpenChange,
  data,
  search,
  context,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PartyCharges;
  search?: string;
  context: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const title = `${data.party?.name ?? ""} · ${data.party?.direction === "income" ? "כל התקבולים" : "כל החיובים"}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} subtitle={context} returnFocusRef={returnFocusRef} panelClassName="ui-sheet-tall ui-charges-sheet">
      <PartyChargesBody data={data} search={search} />
    </Sheet>
  );
}
