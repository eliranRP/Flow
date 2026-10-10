import { formatAmountText, type PartyCharges } from "@flow/shared";
import { useId, type Ref, type RefObject } from "react";
import { Link } from "react-router-dom";
import { absAgorot } from "../agorot";
import { chargesTitle, earlierCharges, partyChangeView, shortMonth, type PartyChangeView } from "../party-charges";
import { cx } from "./cx";
import { formatDayMonth } from "./date-math";
import { ChevronIcon } from "./icons";
import { Sheet } from "./sheet";
import "./css/38-related-charges.css";

/**
 * FLOW-431 (the owner's layout A, 2026-10-10 16:07Z, frames a-inline and a-section-320): under the
 * transaction's switches, "חיובים קודמים" with the usual amount and the change, 6 quiet month bars,
 * the 3 latest earlier charges and "לכל החיובים", which opens the sheet with all of them.
 */

const toneClass = { bad: "ui-delta-bad", good: "ui-delta-good", flat: "ui-delta-flat" } as const;

/** Charges, newest first; each other line opens its own screen, this one is marked. */
function ChargeRows({ data, charges, search }: { data: PartyCharges; charges: PartyCharges["charges"]; search: string }) {
  const currency = data.party?.currency ?? "ILS";
  return (
    <ul className="ui-charges-list">
      {charges.map((charge) => {
        const current = charge.id === data.transaction_id;
        const amount = formatAmountText(absAgorot(charge.amount_minor), currency, { detail: true });
        const date = formatDayMonth(charge.doc_date);
        const name = `${date}, ${amount}${charge.pending ? ", ממתין" : ""}${current ? ", השורה הזו" : ""}`;
        const body = (
          <>
            <span className="ui-charges-date"><bdi dir="ltr">{date}</bdi>{charge.pending ? <span className="t-label text-text-secondary"> · ממתין</span> : null}</span>
            <span className="ui-charges-end">
              <bdi dir="ltr" className="t-amount ui-num">{amount}</bdi>
              {/* FLOW-424 (C18-5): a linked charge ends in a chevron; the open one keeps its place. */}
              <span className="ui-row-chevron ui-charges-chevron" aria-hidden="true">
                {current ? null : <ChevronIcon />}
              </span>
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

/** "בדרך כלל $11.99 · עלה ב־92%": red only for an expense up or income down. */
function ChangeLine({ view }: { view: PartyChangeView }) {
  return (
    <p className="ui-charges-line t-label">
      <span className="text-text-secondary">בדרך כלל <bdi dir="ltr">{view.usual}</bdi></span>
      {" · "}
      <span className={cx("ui-charge-pct", toneClass[view.tone])}>{view.change}</span>
    </p>
  );
}

/**
 * The section under the switches. Nothing shows without a party or with fewer than 2 earlier
 * charges; the change line only with a usual amount.
 */
export function PartyChargesSection({
  data,
  search = "",
  onShowAll,
  showAllRef,
}: {
  data: PartyCharges;
  search?: string;
  onShowAll: () => void;
  showAllRef?: Ref<HTMLButtonElement>;
}) {
  const titleId = useId();
  const earlier = earlierCharges(data);
  if (data.party == null || earlier.length < 2) return null;
  const view = partyChangeView(data);
  return (
    <section className="ui-charges-section" aria-labelledby={titleId}>
      <div className="ui-section-head">
        <h2 className="t-title-3" id={titleId}>{chargesTitle(data)}</h2>
      </div>
      {view == null ? null : <ChangeLine view={view} />}
      <ChargeMonthBars months={data.months} tone={view?.tone ?? "flat"} />
      <ChargeRows data={data} charges={earlier.slice(0, 3)} search={search} />
      {earlier.length > 3 ? (
        <button ref={showAllRef} type="button" className="ui-charges-all ui-hit" aria-haspopup="dialog" onClick={onShowAll}>
          לכל ה{data.party.direction === "income" ? "תקבולים" : "חיובים"}
        </button>
      ) : null}
    </section>
  );
}

/** Six quiet month bars: only the line's month in the tone colour. No axis, legend or figures. */
export function ChargeMonthBars({ months, tone }: { months: PartyCharges["months"]; tone: PartyChangeView["tone"] }) {
  const sizes = months.map((m) => absAgorot(m.amount_minor));
  const top = sizes.reduce((max, size) => (size > max ? size : max), 0n);
  return (
    <div className="ui-charge-bars" aria-hidden="true">
      {months.map((m, index) => {
        const size = sizes[index] ?? 0n;
        const height = top === 0n ? 0 : Math.max(Number((size * 100n) / top), size === 0n ? 0 : 6);
        const current = index === months.length - 1;
        return (
          <div key={m.month} className="ui-charge-bar-col">
            <div className="ui-charge-bar-track">
              <div className={cx("ui-charge-bar", current && "ui-charge-bar-now", current && `ui-charge-bar-${tone}`)} style={{ blockSize: `${String(height)}%` }} />
            </div>
            <span className="ui-charge-bar-label t-label">{shortMonth(m.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The sheet's body: the change in words, the bars, then the charges, newest first. */
export function PartyChargesBody({ data, search = "" }: { data: PartyCharges; search?: string }) {
  const view = partyChangeView(data);
  return (
    <div className="ui-charges">
      {view == null ? null : (
        <p className="ui-charges-change">
          {view.percent == null ? (
            <span className="t-title-2">כמו הרגיל</span>
          ) : (
            <span className={cx("t-title-2 ui-charge-pct", toneClass[view.tone])}>
              {view.arrow} <bdi dir="ltr">{view.percent}</bdi>
            </span>
          )}
          <span className="t-label text-text-secondary ui-nowrap">
            {view.percent == null ? null : "לעומת הרגיל "}
            <bdi dir="ltr">{view.usual}</bdi>
          </span>
        </p>
      )}
      <ChargeMonthBars months={data.months} tone={view?.tone ?? "flat"} />
      <h3 className="ui-charges-head t-label text-text-secondary">{chargesTitle(data)}</h3>
      <ChargeRows data={data} charges={data.charges} search={search} />
    </div>
  );
}

export function PartyChargesSheet({
  open,
  onOpenChange,
  data,
  search,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: PartyCharges;
  search?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={data.party?.name ?? ""} returnFocusRef={returnFocusRef}>
      <PartyChargesBody data={data} search={search} />
    </Sheet>
  );
}
