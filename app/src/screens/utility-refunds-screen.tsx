import "../ui/lazy.css";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompanyCurrency } from "../company-currency";
import { usePreviewSearch, useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldWrites } from "../use-is-viewer";
import { Amount } from "../ui/amount";
import { BackButton } from "../ui/back";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { CompactBar } from "../ui/compact-bar";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { CheckIcon } from "../ui/icons";
import { useScrolledPast } from "../ui/screen-header";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { groupSummary, openTotals, refundGroups } from "../utility-refund-view";
import { UtilityBillSheet } from "./utility-refund-sheet";
import { useUtilityRefundActions } from "./utility-refunds-actions";
import { OpenBillRow, RefundCardView } from "./utility-refunds-parts";

/** The list bar's height (the compact bar at list size). */
const LIST_BAR = 44;

/**
 * FLOW-1135 (V3-UtilityRefunds, the List pattern; decision 0265): החזרי חשבונות. Back to Home (or the property),
 * the title, "N לא הוחזרו", the sum not refunded, then the bills by property under sticky heads: סימון הכל כנראה
 * under the head, a refund the owner matched that is filed elsewhere (its fix card), then the bills not refunded.
 * FLOW-1143 (the owner, 2026-11-09): Flow suggests no refund, so there are no "זה ההחזר?" cards and no filter.
 * `?project=` limits it to one property (its page's row opens it so). FLOW-1159: each property's head has כל החשבונות, its
 * bills by type; a bill opens its drawer (status, pattern, history, the income around it).
 */
export function UtilityRefundsScreen() {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const query = useUtilityRefundsQuery(projectId);
  const holdWrites = useHoldWrites();
  const readOnly = holdWrites;
  const online = useOnline();
  const currency = useCompanyCurrency();
  const actions = useUtilityRefundActions();
  const [opened, setOpened] = useState<UtilityBill | null>(null);
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);

  const bills = query.data?.bills.filter((bill) => projectId == null || bill.project_id === projectId) ?? [];
  const groups = refundGroups(bills, actions.hidden);
  const phase = screenPhase(preview, query);
  const loading = phase.kind === "loading";
  const failed = phase.kind === "error";
  const ready = !loading && !failed;
  const open = groups.reduce((sum, group) => sum + group.open.length, 0);
  const totals = openTotals(groups);
  const property = projectId == null ? null : bills[0]?.project_name ?? null;
  const back = projectId == null ? `/${search}` : `/projects/${projectId}${search}`;
  const backText = projectId == null ? "בית" : property ?? "פרויקט";
  const since = !online && query.data != null ? query.dataUpdatedAt : undefined;

  const [firstTotal] = totals;

  return (
    <div className="ui-urf-screen">
      <CompactBar
        title="החזרי חשבונות"
        figure={firstTotal == null ? undefined : <Amount agorot={firstTotal.minor} currency={firstTotal.currency} direction="expense" cents="always" />}
        label={backText}
        backTo={back}
        shown={barShown}
      />
      <header className="ui-urf-head">
        <BackButton fallback={back} text={backText} />
        <h1 className="t-title">החזרי חשבונות</h1>
        {ready ? (
          <>
            <p className="ui-urf-sub t-meta">{`${String(open)} לא הוחזרו`}</p>
            {totals.length === 0 ? (
              <p className="ui-urf-figure ui-urf-figure-zero t-detail"><Amount agorot={0n} currency={currency} size="total" cents="always" zeroCents /></p>
            ) : totals.map((total) => (
              <p key={total.currency} className="ui-urf-figure t-detail">
                <Amount agorot={total.minor} currency={total.currency} size="total" direction="expense" cents="always" />
              </p>
            ))}
            <p className="ui-urf-sub t-caption">חשבונות שהחברה שילמה והשוכר עוד לא החזיר · נבדק 30 יום אחרי החיוב</p>
          </>
        ) : null}
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {loading ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : failed ? (
        <PageLoadFailed title="החזרי החשבונות לא נטענו" offline={!online || phase.offline} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <div className="ui-urf-empty">
          <EmptyState
            icon={<CheckIcon size={40} stroke={2.2} />}
            title="כל החשבונות הוחזרו או נבדקו"
            body="חשבון שהחברה שילמה והשוכר לא החזיר תוך 30 יום יופיע כאן."
            action={<Button full to={back}>{projectId == null ? "חזרה לבית" : "חזרה לפרויקט"}</Button>}
          />
        </div>
      ) : (
        <>
          {since == null ? null : <BandOfflineLine since={since} onPage />}
          {groups.map((group) => (
            <section key={group.projectId} className="ui-month ui-urf-group" aria-labelledby={`urf-${group.projectId}`}>
              <GroupHead id={`urf-${group.projectId}`} title={group.name} summary={groupSummary(group)} />
              {/* FLOW-1159: the way into the property's bills by type, beside סימון הכל כנראה. */}
              <div className="ui-urf-head-links">
                {readOnly || group.open.length < 2 ? <span /> : (
                  <Button variant="link" onClick={() => { actions.markAll(group); }}>סימון הכל כנראה</Button>
                )}
                <Button variant="link" chevron to={`/projects/${group.projectId}/utilities/bills${search}`}>כל החשבונות</Button>
              </div>
              {group.cards.map((card) => (
                <RefundCardView
                  key={card.key}
                  card={card}
                  leaving={actions.leaving.has(card.key)}
                  readOnly={readOnly}
                  onRefile={(category) => { actions.refile(card, category); }}
                  onKeep={() => { actions.keep(card); }}
                />
              ))}
              {group.open.length === 0 ? null : (
                <ul className="ui-urf-list" aria-label={`לא הוחזרו: ${group.name}`}>
                  {group.open.map((bill) => (
                    <OpenBillRow
                      key={bill.bill_transaction_id}
                      bill={bill}
                      leaving={actions.leaving.has(bill.bill_transaction_id)}
                      readOnly={readOnly}
                      onOpen={() => { setOpened(bill); }}
                      onSeen={() => { actions.seen(bill); }}
                    />
                  ))}
                </ul>
              )}
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
            actions.company(bill, groups);
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
