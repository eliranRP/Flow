import { formatAmountText, type PartyCharges } from "@flow/shared";
import type { Ref, RefObject } from "react";
import { Link } from "react-router-dom";
import { absAgorot } from "../agorot";
import { chargesTitle, partyChangeView, shortMonth, type PartyChangeView } from "../party-charges";
import { cx } from "./cx";
import { formatDayMonth } from "./date-math";
import { ChevronIcon } from "./icons";
import { Sheet } from "./sheet";

/**
 * FLOW-431 (owner's pick B, 2026-10-10, frames b-1-chip and b-2-sheet): under the transaction's
 * status pills, one chip "▲ 92% לעומת הרגיל $11.99"; a tap opens the party's earlier charges.
 */

const toneClass = { bad: "ui-delta-bad", good: "ui-delta-good", flat: "ui-delta-flat" } as const;

/** The % and the usual amount; the whole chip is the button that opens the sheet. */
export function ChargeChangeChip({ view, onClick, buttonRef }: { view: PartyChangeView; onClick: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={buttonRef} type="button" className="ui-status ui-charge-chip ui-hit" aria-haspopup="dialog" aria-label={view.words} onClick={onClick}>
      <span aria-hidden="true" className="ui-charge-chip-text" data-clip-ok="">
        {view.percent == null ? null : (
          <span className={cx("ui-charge-pct", toneClass[view.tone])}>
            {view.arrow} <bdi dir="ltr">{view.percent}</bdi>
          </span>
        )}{" "}
        <span className="ui-nowrap">
          {view.percent == null ? "כמו הרגיל" : "לעומת הרגיל"} <bdi dir="ltr">{view.usual}</bdi>
        </span>
      </span>
      <span className="ui-charge-chip-chevron" aria-hidden="true">
        <ChevronIcon size={16} />
      </span>
    </button>
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
  const currency = data.party?.currency ?? "ILS";
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
      <ul className="ui-charges-list">
        {data.charges.map((charge) => {
          const current = charge.id === data.transaction_id;
          const amount = formatAmountText(absAgorot(charge.amount_minor), currency, { detail: true });
          const date = formatDayMonth(charge.doc_date);
          const name = `${date}, ${amount}${charge.pending ? ", ממתין" : ""}${current ? ", השורה הזו" : ""}`;
          const body = (
            <>
              <span className="ui-charges-date"><bdi dir="ltr">{date}</bdi>{charge.pending ? <span className="t-label text-text-secondary"> · ממתין</span> : null}</span>
              <bdi dir="ltr" className="t-amount ui-num">{amount}</bdi>
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
