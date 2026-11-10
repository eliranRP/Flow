import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useProjectsCashMonth } from "../project-cash";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldWrites } from "../use-is-viewer";
import { Amount } from "../ui/amount";
import { BackButton } from "../ui/back";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { CompactBar } from "../ui/compact-bar";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { HintParts } from "../ui/hint-parts";
import { CheckIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { useScrolledPast } from "../ui/screen-header";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { StatusMark } from "../ui/status-mark";
import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { billsByType, billStatusLine, isOpenBill, refundDate, refundGroups, tenantOwes, type BillType, type Totals } from "../utility-refund-view";
import { billMark } from "./utility-bill-context";
import { UtilityBillSheet } from "./utility-refund-sheet";
import { useUtilityRefundActions } from "./utility-refunds-actions";

/** The list bar's height (the compact bar at list size). */
const LIST_BAR = 44;

const money = (totals: Totals) => totals.map((item) => formatAmountText(item.minor, item.currency, { detail: true })).join(" + ");

/** A type's head line: "חסר $X" in the signal colour, or "הכול הוחזר". */
function TypeSummary({ type }: { type: BillType }) {
  if (type.missing.length === 0) return "הכול הוחזר";
  return <span className="ui-urb-missing">{"חסר "}<bdi dir="ltr">{money(type.missing)}</bdi></span>;
}

/**
 * FLOW-1159 (V3-J-B3-ByType, the List pattern): a property's bills by type, opened from its חשבונות · מי משלם page and
 * from כל החשבונות on the refunds list. Under the title, what the tenant owes ("השוכר חייב $X", or "הכול הוחזר");
 * then one head per type (the bill's category) with what is missing, and its bills newest activity first: the mark
 * (✓ refunded, a dashed ring while owed, a dot for ראיתי), "dd/mm/yy · supplier", its status line and its amount.
 * A bill opens its drawer; a viewer's row opens its transaction. It replaces the by-month page (FLOW-1144).
 */
export function ProjectUtilityBillsScreen() {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const online = useOnline();
  const readOnly = useHoldWrites();
  const query = useUtilityRefundsQuery(projectId, true, true);
  const actions = useUtilityRefundActions();
  const cash = useProjectsCashMonth(undefined, projectId).data?.projects.find((item) => item.id === projectId)?.name ?? null;
  const [opened, setOpened] = useState<UtilityBill | null>(null);
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);
  const phase = screenPhase(preview, query);
  const bills = query.data?.bills.filter((bill) => bill.project_id === projectId) ?? [];
  const types = billsByType(bills);
  const owes = tenantOwes(bills);
  const name = bills[0]?.project_name ?? cash;
  const back = `/projects/${projectId}/utilities${search}`;
  const since = !online && query.data != null ? query.dataUpdatedAt : undefined;
  const [firstOwed] = owes;
  return (
    <div className="ui-urf-screen">
      <CompactBar
        title="חשבונות מול השוכר"
        figure={firstOwed == null ? undefined : <Amount agorot={firstOwed.minor} currency={firstOwed.currency} direction="expense" cents="always" />}
        label="חשבונות · מי משלם"
        backTo={back}
        shown={barShown}
      />
      <header className="ui-urf-head">
        <BackButton fallback={back} text="חשבונות · מי משלם" />
        <h1 className="t-title">חשבונות מול השוכר</h1>
        <p className="ui-urf-sub t-meta">{name == null ? "לפי סוג חשבון" : `${name} · לפי סוג חשבון`}</p>
        {phase.kind !== "ready" || bills.length === 0 ? null : owes.length === 0 ? (
          <p className="ui-urf-sub t-meta">הכול הוחזר</p>
        ) : (
          <>
            <p className="ui-urf-sub t-meta">השוכר חייב</p>
            {owes.map((total) => (
              <p key={total.currency} className="ui-urf-figure t-detail">
                <Amount agorot={total.minor} currency={total.currency} size="total" direction="expense" cents="always" />
              </p>
            ))}
          </>
        )}
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {phase.kind === "loading" ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : phase.kind === "error" ? (
        <PageLoadFailed title="החשבונות לא נטענו" offline={!online || phase.offline} onRetry={() => void query.refetch()} />
      ) : bills.length === 0 ? (
        <EmptyState icon={<CheckIcon size={40} stroke={2.2} />} title="אין עדיין חשבונות בנכס" body="חשבון שהחברה שילמה והשוכר מחזיר יופיע כאן, לפי סוג." />
      ) : (
        <>
          {since == null ? null : <BandOfflineLine since={since} onPage />}
          {types.map((type, index) => (
            <section key={type.name} className="ui-month ui-urf-group" aria-labelledby={`urb-${String(index)}`}>
              <GroupHead id={`urb-${String(index)}`} title={type.name} summary={<TypeSummary type={type} />} />
              <List>
                {type.bills.map((bill) => (
                  <ListRow
                    key={bill.bill_transaction_id}
                    variant="project"
                    layout="flat"
                    title={`${refundDate(bill.doc_date)} · ${bill.supplier_name ?? "ספק"}`}
                    // A narrow line breaks only between whole parts, with no "·" at either end (FLOW-1153).
                    hint={<HintParts text={billStatusLine(bill)} />}
                    wrapHint
                    wrapTitle
                    tone={isOpenBill(bill) ? "warning" : undefined}
                    icon={<StatusMark kind={billMark(bill)} />}
                    agorot={-bill.amount_minor}
                    currency={bill.currency}
                    signed
                    href={readOnly ? `/transactions/${bill.bill_transaction_id}${search}` : undefined}
                    onClick={readOnly ? undefined : () => { setOpened(bill); }}
                  />
                ))}
              </List>
            </section>
          ))}
        </>
      )}
      {readOnly ? null : (
        <UtilityBillSheet
          bill={opened}
          onOpenChange={(next) => { if (!next) setOpened(null); }}
          onSeen={(bill) => {
            setOpened(null);
            actions.seen(bill);
          }}
          onCompany={(bill) => {
            setOpened(null);
            actions.company(bill, refundGroups(bills, actions.hidden));
          }}
          onPicked={(bill, paymentId) => {
            setOpened(null);
            actions.picked(bill, paymentId);
          }}
        />
      )}
    </div>
  );
}
