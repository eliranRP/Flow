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
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { CheckIcon } from "../ui/icons";
import { useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { askingCards, groupSummary, openTotals, refundGroups, type RefundFilter } from "../utility-refund-view";
import { UtilityBillSheet } from "./utility-refund-sheet";
import { useUtilityRefundActions } from "./utility-refunds-actions";
import { OpenBillRow, RefundCardView } from "./utility-refunds-parts";

/** The list bar's height (the compact bar at list size), the docking hook's `bar`. */
const LIST_BAR = 44;

/**
 * FLOW-1135 (V3-UtilityRefunds, the List pattern; decision 0265): החזרי חשבונות. Back to Home (or the property),
 * the title, "N לא הוחזרו · M לבדיקה", the sum not refunded, then הכול / לבדיקה / לא הוחזרו, which docks into the
 * compact bar. The bills by property under sticky heads: the suggested refunds first, then the bills not refunded,
 * with סימון הכל כנראה under the head. `?project=` limits it to one property (its page's row opens it so).
 * `sample` draws the stories, with answers on the screen only.
 */
export function UtilityRefundsScreen({ sample }: { sample?: UtilityBill[] } = {}) {
  const live = sample == null;
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const query = useUtilityRefundsQuery(projectId, live);
  const holdWrites = useHoldWrites();
  const readOnly = holdWrites;
  const online = useOnline();
  const currency = useCompanyCurrency();
  const actions = useUtilityRefundActions(live);
  const [filter, setFilter] = useState<RefundFilter>("all");
  const [opened, setOpened] = useState<UtilityBill | null>(null);
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: LIST_BAR });

  const bills = (live ? query.data?.bills : sample)?.filter((bill) => projectId == null || bill.project_id === projectId) ?? [];
  const groups = refundGroups(bills, actions.local);
  const phase = live ? screenPhase(preview, query) : ({ kind: "ready" } as const);
  const loading = phase.kind === "loading";
  const failed = phase.kind === "error";
  const ready = !loading && !failed;
  const asking = askingCards(groups).length;
  const open = groups.reduce((sum, group) => sum + group.open.length, 0);
  const totals = openTotals(groups);
  const property = projectId == null ? null : bills[0]?.project_name ?? null;
  const back = projectId == null ? `/${search}` : `/projects/${projectId}${search}`;
  const backText = projectId == null ? "בית" : property ?? "פרויקט";
  const since = live && !online && query.data != null ? query.dataUpdatedAt : undefined;

  const control = (
    <SegmentedControl<RefundFilter>
      label="סינון החזרי חשבונות"
      showLabel={false}
      value={filter}
      options={[
        { value: "all", label: "הכול" },
        { value: "review", label: "לבדיקה" },
        { value: "open", label: "לא הוחזרו" },
      ]}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  const shown = groups
    .map((group) => ({
      ...group,
      cards: filter === "open" ? [] : group.cards,
      open: filter === "review" ? [] : group.open,
    }))
    .filter((group) => group.cards.length + group.open.length > 0);
  const hasRows = ready && groups.length > 0;
  const [firstTotal] = totals;

  return (
    <div className="ui-urf-screen">
      <CompactBar
        title="החזרי חשבונות"
        figure={firstTotal == null ? undefined : <Amount agorot={firstTotal.minor} currency={firstTotal.currency} direction="expense" cents="always" />}
        label={backText}
        backTo={back}
        shown={barShown}
        dock={hasRows ? control : undefined}
        docked={docked}
      />
      <header className="ui-urf-head">
        <BackButton fallback={back} text={backText} />
        <h1 className="t-title">החזרי חשבונות</h1>
        {ready ? (
          <>
            <p className="ui-urf-sub t-meta">{`${String(open)} לא הוחזרו · ${String(asking)} לבדיקה`}</p>
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
          <div>
            <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
            <DockSlot docked={docked}>{control}</DockSlot>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              title={filter === "review" ? "אין החזרים לבדיקה" : "אין חשבונות שלא הוחזרו"}
              body={filter === "review" ? "כל התשלומים שהצענו נענו." : "כל החשבונות הוחזרו או סומנו."}
            />
          ) : shown.map((group) => (
            <section key={group.projectId} className="ui-month ui-urf-group" aria-labelledby={`urf-${group.projectId}`}>
              <GroupHead id={`urf-${group.projectId}`} title={group.name} summary={groupSummary(group)} />
              {readOnly || group.open.length < 2 ? null : (
                <div className="ui-urf-mark-all">
                  <Button variant="link" onClick={() => { actions.markAll(group); }}>סימון הכל כנראה</Button>
                </div>
              )}
              {group.cards.map((card) => (
                <RefundCardView
                  key={card.key}
                  card={card}
                  readOnly={readOnly}
                  onYes={() => { actions.yes(card); }}
                  onNo={() => { actions.no(card); }}
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
