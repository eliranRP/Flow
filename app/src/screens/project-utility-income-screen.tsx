import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { BackButton } from "../ui/back";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { CompactBar } from "../ui/compact-bar";
import { GroupHead } from "../ui/group-head";
import { ChevronIcon } from "../ui/icons";
import { useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { useUtilityIncomeQuery, type UtilityIncome } from "../utility-refunds";
import { incomeBillStatus, incomeRows, refundDate, type IncomeRow } from "../utility-refund-view";

/** The list bar's height (the compact bar at list size). */
const LIST_BAR = 44;

type Window = "1" | "2" | "3";

const WINDOWS: { value: Window; label: string; range: string }[] = [
  { value: "1", label: "חודש", range: "חודש" },
  { value: "2", label: "חודשיים", range: "חודשיים" },
  { value: "3", label: "3 חודשים", range: "3 חודשים" },
];

/** The checked bill, pinned: a dashed signal border, its label, who and when, its status and its amount. */
function CheckedBill({ income }: { income: UtilityIncome }) {
  const bill = income.bill;
  const open = bill.state === "not_refunded" || bill.state === "waiting";
  return (
    <section className="ui-uri-bill" aria-label="החשבון שבודקים">
      <p className="ui-uri-bill-label t-caption">החשבון שבודקים</p>
      <div className="ui-uri-bill-main">
        <span className="ui-uri-bill-text">
          <span className="ui-uri-bill-title">{[bill.supplier_name ?? "ספק", bill.category_name, refundDate(bill.doc_date)].filter(Boolean).join(" · ")}</span>
          <span className="ui-uri-bill-status" data-open={open || undefined}>{incomeBillStatus(income)}</span>
        </span>
        <bdi dir="ltr" className="ui-uri-bill-amount">{formatAmountText(bill.amount_minor, bill.currency, { detail: true, direction: "expense" })}</bdi>
      </div>
    </section>
  );
}

/** A payment: its payer and date, the part that is the bill's type (what it refunded), its other parts, and its amount. */
function PaymentRow({ row, search }: { row: Extract<IncomeRow, { kind: "payment" }>; search: string }) {
  return (
    <li className="ui-uri-item">
      <Link className="ui-uri-link" to={`/transactions/${row.transactionId}${search}`} aria-label={`${row.title} · ${row.hit} · ${row.amount} · פתיחת התנועה`}>
        <span className="ui-uri-text">
          <span className="ui-uri-title">{row.title}</span>
          <span className="ui-uri-hit" data-missing={row.hitMissing || undefined}>{row.hit}</span>
          {row.others == null ? null : <span className="ui-uri-others">{row.others}</span>}
        </span>
        <bdi dir="ltr" className="ui-uri-amount">{row.amount}</bdi>
        <span className="ui-uri-chevron" aria-hidden="true"><ChevronIcon size={16} /></span>
      </Link>
    </li>
  );
}

/**
 * FLOW-1159 (V3-J-Income, the List pattern): נכנס סביב החשבון, opened from a bill's drawer. The checked bill pinned in a
 * dashed card, a חודש / חודשיים / 3 חודשים switch (2 by default), then the property's money in around the bill, newest
 * first: each payment with the part that is the bill's type and the bills it paid back (the signal colour when no part
 * is), and the dashed line that marks where the bill is. Every payment opens its transaction.
 */
export function ProjectUtilityIncomeScreen() {
  const { projectId = "", billId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const online = useOnline();
  const [span, setSpan] = useState<Window>("2");
  const query = useUtilityIncomeQuery(billId, Number(span));
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);
  const phase = screenPhase(preview, query);
  const income = query.data;
  const back = `/projects/${projectId}/utilities/bills${search}`;
  const since = !online && income != null ? query.dataUpdatedAt : undefined;
  const rows = income == null ? [] : incomeRows(income);
  const none = income != null && income.lines.length === 0;
  const range = WINDOWS.find((item) => item.value === span)?.range ?? "";
  return (
    <div className="ui-urf-screen">
      <CompactBar title="נכנס סביב החשבון" label="חשבונות מול השוכר" backTo={back} shown={barShown} />
      <header className="ui-urf-head">
        <BackButton fallback={back} text="חשבונות מול השוכר" />
        <h1 className="t-title">נכנס סביב החשבון</h1>
        {income == null ? null : <p className="ui-urf-sub t-meta">{[income.bill.project_name, income.bill.category_name].filter(Boolean).join(" · ")}</p>}
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {phase.kind === "loading" ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : phase.kind === "error" || income == null ? (
        <PageLoadFailed title="התנועות לא נטענו" offline={!online || (phase.kind === "error" && phase.offline)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {since == null ? null : <BandOfflineLine since={since} onPage />}
          <CheckedBill income={income} />
          <SegmentedControl<Window>
            label="טווח"
            showLabel={false}
            value={span}
            options={WINDOWS.map((item) => ({ value: item.value, label: item.label }))}
            onChange={setSpan}
          />
          <section className="ui-month ui-urf-group" aria-labelledby="uri-head">
            <GroupHead id="uri-head" title="תשלומים מהשוכר" summary={`${range} לפני ואחרי`} />
            {none ? <p className="ui-uri-none">לא נכנס תשלום מהשוכר בטווח הזה</p> : null}
            <ul className="ui-uri-list" aria-label="תשלומים מהשוכר">
              {rows.map((row) => row.kind === "bill" ? (
                <li key={row.key} className="ui-uri-marker">
                  <span className="ui-uri-marker-label">{row.label}</span>
                </li>
              ) : (
                <PaymentRow key={row.key} row={row} search={search} />
              ))}
            </ul>
          </section>
          <p className="ui-utl-lead">רק התנועות שנכנסו לנכס הזה סביב תאריך החשבון. הקו המקווקו מסמן איפה החשבון. כל תשלום נפתח.</p>
        </>
      )}
    </div>
  );
}
