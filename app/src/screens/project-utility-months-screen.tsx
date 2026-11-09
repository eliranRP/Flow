import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useCompanyCurrency } from "../company-currency";
import { useProjectsCashMonth } from "../project-cash";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { BackButton } from "../ui/back";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { CompactBar } from "../ui/compact-bar";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { CheckIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { useScrolledPast } from "../ui/screen-header";
import { Sheet } from "../ui/sheet";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { StatusMark } from "../ui/status-mark";
import { useUtilityMonthsQuery, type UtilityMonth } from "../utility-refunds";
import { refundDate, utilityMonthCurrency, utilityMonthLabel, utilityMonthStatus } from "../utility-refund-view";

/** The list bar's height (the compact bar at list size). */
const LIST_BAR = 44;

const money = (minor: bigint, currency: string) => formatAmountText(minor, currency, { detail: true });

/** A month's row: "שכירות $X · חשבונות $Y", then its status, in the signal colour unless every bill is back. */
function MonthHint({ month, currency }: { month: UtilityMonth; currency: string }) {
  const status = utilityMonthStatus(month, currency);
  const rent = month.rent_lines.length === 0 && month.rent_in === 0n ? "—" : money(month.rent_in, currency);
  return (
    <>
      <span className="ui-utm-sums">
        {"שכירות "}
        <bdi dir="ltr" className="ui-utm-rent">{rent}</bdi>
        {" · חשבונות "}
        <bdi dir="ltr">{money(month.bills_paid, currency)}</bdi>
      </span>
      <span className="ui-utm-status" data-ok={status.ok || undefined}>{status.text}</span>
    </>
  );
}

/**
 * FLOW-1144 (V3-Project-UtilityMonths): one month in a sheet. The month and its status, then "נכנס מהשוכר" (the rent
 * lines) and "חשבונות ששולמו" (each tenant-paid bill with its mark, ✓ refunded or a dashed ring not refunded), each
 * group with its total. Every line opens its transaction.
 */
function MonthSheet({ month, currency, search, onOpenChange }: { month: UtilityMonth | null; currency: string; search: string; onOpenChange: (open: boolean) => void }) {
  const [shown, setShown] = useState<UtilityMonth | null>(month);
  // The sheet keeps drawing the month while it slides out.
  if (month != null && month !== shown) setShown(month);
  const current = month ?? shown;
  const cur = current == null ? currency : utilityMonthCurrency(current, currency);
  const status = current == null ? null : utilityMonthStatus(current, cur);
  return (
    <Sheet open={month != null} onOpenChange={onOpenChange} title={current == null ? "" : utilityMonthLabel(current.month)}>
      {current == null || status == null ? null : (
        <>
          <p className="ui-utm-status ui-utm-sheet-status" data-ok={status.ok || undefined}>{status.text}</p>
          <section className="ui-utm-group" aria-labelledby="utm-in">
            <GroupHead id="utm-in" title="נכנס מהשוכר" summary={<bdi dir="ltr">{money(current.rent_in, cur)}</bdi>} />
            {current.rent_lines.length === 0 ? (
              <p className="ui-utm-none">לא נכנס תשלום החודש</p>
            ) : (
              <List>
                {current.rent_lines.map((line) => (
                  <ListRow
                    key={line.transaction_id}
                    variant="project"
                    layout="flat"
                    title={line.party ?? "שכירות"}
                    hint={[line.category_name, refundDate(line.doc_date)].filter((part): part is string => part != null).join(" · ")}
                    icon={<StatusMark kind="paid" />}
                    agorot={line.amount_minor}
                    currency={line.currency}
                    signed
                    href={`/transactions/${line.transaction_id}${search}`}
                  />
                ))}
              </List>
            )}
          </section>
          <section className="ui-utm-group" aria-labelledby="utm-bills">
            <GroupHead id="utm-bills" title="חשבונות ששולמו" summary={<bdi dir="ltr">{money(current.bills_paid, cur)}</bdi>} />
            <List>
              {current.bills.map((bill) => {
                const back = bill.state === "refunded";
                return (
                  <ListRow
                    key={bill.bill_transaction_id}
                    variant="project"
                    layout="flat"
                    title={bill.supplier_name ?? "ספק"}
                    hint={[bill.category_name, refundDate(bill.doc_date), back ? "הוחזר" : "לא הוחזר"].filter((part): part is string => part != null).join(" · ")}
                    tone={back ? undefined : "warning"}
                    icon={<StatusMark kind={back ? "paid" : "late"} />}
                    agorot={-bill.amount_minor}
                    currency={bill.currency}
                    signed
                    href={`/transactions/${bill.bill_transaction_id}${search}`}
                  />
                );
              })}
            </List>
          </section>
        </>
      )}
    </Sheet>
  );
}

/**
 * FLOW-1144 (V3-Project-UtilityMonths, the List pattern): לפי חודש, opened from the property's חשבונות · מי משלם page.
 * One row per month, newest first: the month, "שכירות $X · חשבונות $Y" and its status (✓ "כל החשבונות הוחזרו",
 * "חסר $X", or "לא נכנסה שכירות"). A month opens its sheet. Only tenant-paid utilities count (the server's read).
 */
export function ProjectUtilityMonthsScreen() {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const online = useOnline();
  const currency = useCompanyCurrency();
  const query = useUtilityMonthsQuery(projectId);
  const name = useProjectsCashMonth(undefined, projectId).data?.projects.find((item) => item.id === projectId)?.name ?? null;
  const [opened, setOpened] = useState<UtilityMonth | null>(null);
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);
  const phase = screenPhase(preview, query);
  const months = query.data ?? [];
  const back = `/projects/${projectId}/utilities${search}`;
  return (
    <div className="ui-urf-screen">
      <CompactBar title="לפי חודש" label="חשבונות · מי משלם" backTo={back} shown={barShown} />
      <header className="ui-urf-head">
        <BackButton fallback={back} text="חשבונות · מי משלם" />
        <h1 className="t-title">לפי חודש</h1>
        <p className="ui-urf-sub t-meta">{name == null ? "האם החשבונות הוחזרו" : `${name} · האם החשבונות הוחזרו`}</p>
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {phase.kind === "loading" ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : phase.kind === "error" ? (
        <PageLoadFailed title="החודשים לא נטענו" offline={!online || phase.offline} onRetry={() => void query.refetch()} />
      ) : months.length === 0 ? (
        <EmptyState icon={<CheckIcon size={40} stroke={2.2} />} title="אין עדיין חשבונות בנכס" body="חודש שבו שולם חשבון שהשוכר מחזיר יופיע כאן, עם השכירות שנכנסה." />
      ) : (
        <>
          <List className="ui-utm-list">
            {months.map((month) => {
              const cur = utilityMonthCurrency(month, currency);
              const status = utilityMonthStatus(month, cur);
              return (
                <ListRow
                  key={month.month}
                  variant="button"
                  layout="flat"
                  title={utilityMonthLabel(month.month)}
                  hint={<MonthHint month={month} currency={cur} />}
                  wrapHint
                  icon={<StatusMark kind={status.ok ? "paid" : "late"} />}
                  chevron
                  onClick={() => { setOpened(month); }}
                />
              );
            })}
          </List>
          <p className="ui-utl-lead">לחיצה על חודש פותחת את התנועות שלו. כל תנועה נפתחת.</p>
        </>
      )}
      <MonthSheet month={opened} currency={currency} search={search} onOpenChange={(next) => { if (!next) setOpened(null); }} />
    </div>
  );
}
