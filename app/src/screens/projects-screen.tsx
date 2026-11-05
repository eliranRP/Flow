import "../ui/lazy.css";
import { formatAmountText, type Dashboard, type ProjectCashRow, type ProjectsCashMonth } from "@flow/shared";
import { useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useOpenFromQuery } from "../open-from-query";
import { cashMonthName } from "../cash";
import { monthPeriod, shiftMonthKey } from "../period";
import { useProjectsCashMonth } from "../project-cash";
import { withPeriodSearch } from "../project-period";
import { groupProjectRows, isOverBudget, netIn, projectMeta, projectsMonthTotals, type ProjectsFilter } from "../project-list";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useDashboardQuery } from "../use-books";
import { israelToday } from "../ui/date-math";
import { useSheetHistory } from "../ui/back";
import { Amount } from "../ui/amount";
import { AttentionCards } from "../ui/attention-cards";
import { BandLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { IconButton } from "../ui/icon-button";
import { CheckIcon, HomeIcon, PlusIcon, SearchIcon } from "../ui/icons";
import { Avatar } from "../ui/avatar";
import { List, ListRow } from "../ui/list-row";
import { MonthStepper } from "../ui/month-stepper";
import { ScreenHeader, useScrolledPast } from "../ui/screen-header";
import { ProjectsSkeleton } from "../ui/screen-skeletons";
import { SegmentedControl } from "../ui/segmented-control";
import { Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";
import { ProjectFormSheet } from "./project-form-sheet";
import { projectsAttentionRows, useProjectsRecurring, type ProjectsRecurringSample } from "./project-attention";

/** The Home-style band bar: 6 + 52 + 6 (BUILD-PLAN §3.1). */
const BAND_BAR = 64;

const FILTERS: { value: ProjectsFilter; label: string }[] = [
  { value: "active", label: "פעילים" },
  { value: "finished", label: "הסתיימו" },
  { value: "all", label: "הכול" },
];

/**
 * FLOW-445: the Projects tab. FLOW-1044 (board V3-Projects): an Overview. The band holds the month's cash
 * across the projects with the month's arrows, then דורש טיפול as row-cards, then פעילים / הסתיימו / הכול
 * (it docks into the band bar), then the rows in groups by kind with one-line sticky heads.
 */
export function ProjectsScreen({
  sample,
  cashSample,
  recurringSample,
  finishedOpen: openFinished = false,
  now,
}: {
  sample?: Dashboard;
  cashSample?: ProjectsCashMonth;
  /** Late bills and changed charges as they would come back, for the attention rows (stories). */
  recurringSample?: ProjectsRecurringSample;
  /** Stories and the proof build open הסתיימו at once. */
  finishedOpen?: boolean;
  /** Stories pin the month names. */
  now?: Date;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const currentKey = israelToday(now).slice(0, 7);
  const [monthKey, setMonthKey] = useState(currentKey);
  const dashboard = useDashboardQuery(sample == null);
  const cash = useProjectsCashMonth(monthKey === currentKey ? undefined : monthKey);
  const recurring = useProjectsRecurring(cashSample == null && monthKey === currentKey, recurringSample);
  const holdWrites = useHoldWrites();
  const online = useOnline();
  const [open, setOpenState] = useState(false);
  const adopt = useRef(false);
  // Back closes the sheet. A quick action opened over this page adopts its entry (one Back closes).
  const setOpen = useSheetHistory("project-new", open, setOpenState, undefined, adopt);
  // FLOW-331: + → פרויקט חדש lands here with ?new=project.
  useOpenFromQuery("project", !holdWrites, (sameEntry) => {
    adopt.current = sameEntry;
    setOpen(true);
  });
  // A finish lands here with הסתיימו picked, so the project it moved is in view.
  const finishedFromRoute = (location.state as { finishedOpen?: boolean } | null)?.finishedOpen === true;
  const [filter, setFilter] = useState<ProjectsFilter>(finishedFromRoute || openFinished ? "finished" : "active");
  const month = cashSample ?? cash.data;
  // The dashboard first, then the cash month: a pending or failed cash read is the screen's phase too.
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard.isPending || dashboard.isError || cashSample != null ? dashboard : cash);
  const onNew = holdWrites ? undefined : () => { setOpen(true); };
  const sheet = <ProjectFormSheet open={open} onOpenChange={setOpen} />;
  const actions = (
    <span className="ui-projects-head-actions">
      <IconButton to={`/search${search}`} label="חיפוש" onBand>
        <SearchIcon />
      </IconButton>
      {onNew == null ? null : (
        <IconButton label="פרויקט חדש" onBand onClick={onNew}>
          <PlusIcon />
        </IconButton>
      )}
    </span>
  );
  const title = <FocusTitle className="t-title ui-projects-band-title">פרויקטים</FocusTitle>;
  if (phase.kind === "empty" || (phase.kind === "ready" && (month?.projects.length ?? 0) === 0 && monthKey === currentKey)) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenHeader layout="stacked" title="פרויקטים" trailing={<span className="ui-header-slot" aria-hidden="true" />} className="ui-tab-root-head" />
        <div className="ui-state-empty flex min-h-0 flex-1 flex-col">
          <EmptyState
            icon={<HomeIcon />}
            title="עוד אין פרויקטים"
            body={holdWrites ? "פרויקטים מגיעים מ־SUMIT." : "פרויקט מרכז את ההכנסות וההוצאות של נכס או עבודה, ומראה אם הוא מרוויח."}
            action={onNew == null ? undefined : <Button onClick={onNew}>פרויקט חדש</Button>}
          />
        </div>
        {sheet}
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <>
        <BandLoadFailed
          title="הפרויקטים לא נטענו"
          offline={phase.offline || !online}
          leading={title}
          onRetry={() => { void dashboard.refetch(); void cash.refetch(); }}
        />
        {sheet}
      </>
    );
  }
  if (phase.kind === "loading" || month == null) {
    return (
      <div className="ui-projects-page flex min-h-full flex-1 flex-col" aria-busy="true">
        <TopBand
          wordmark={false}
          leading={title}
          trailing={actions}
          heroClassName="ui-band-hero-project"
          hero={(
            <div className="ui-project-skel">
              <Skeleton tone="band" className="ui-skel-project-label" />
              <Skeleton tone="band" className="ui-skel-project-num" />
            </div>
          )}
        />
        <ProjectsSkeleton />
        {sheet}
      </div>
    );
  }
  return (
    <>
      <ProjectsOverview
        month={month}
        monthKey={monthKey}
        currentKey={currentKey}
        onMonth={setMonthKey}
        title={title}
        actions={actions}
        search={search}
        filter={filter}
        setFilter={setFilter}
        recurring={recurring}
        now={now}
      />
      {sheet}
    </>
  );
}

function ProjectsOverview({
  month,
  monthKey,
  currentKey,
  onMonth,
  title,
  actions,
  search,
  filter,
  setFilter,
  recurring,
  now,
}: {
  month: NonNullable<ProjectsCashMonth>;
  monthKey: string;
  currentKey: string;
  onMonth: (key: string) => void;
  title: ReactNode;
  actions: ReactNode;
  search: string;
  filter: ProjectsFilter;
  setFilter: (value: ProjectsFilter) => void;
  recurring: ProjectsRecurringSample;
  now?: Date;
}) {
  const base = month.base_currency;
  const totals = projectsMonthTotals(month);
  const isCurrent = monthKey === currentKey;
  const monthName = cashMonthName(monthKey, now);
  const monthSearch = withPeriodSearch(search, monthPeriod(monthKey));
  // The band's figure scrolls under the bar, then the band bar slides in; the filter docks into it.
  const [bandMark, setBandMark] = useState<HTMLSpanElement | null>(null);
  const barShown = useScrolledPast(bandMark, true, 0);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: BAND_BAR });
  const groups = groupProjectRows(month.projects, filter, base);
  // The month's cards read this month's late bills: a past month shows only its lines with no project.
  const attention = projectsAttentionRows({
    month,
    late: isCurrent ? recurring.late : [],
    search,
    unassignedTo: `/projects/unassigned${monthSearch}`,
  });
  const control = (onBand: boolean) => (
    <SegmentedControl
      label="סינון פרויקטים"
      showLabel={false}
      tone={onBand ? "band" : "page"}
      value={filter}
      options={FILTERS}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  const net = BigInt(totals.net);
  return (
    <div className="ui-projects-page ui-project-page flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={title}
        trailing={actions}
        heroClassName="ui-band-hero-project"
        hero={(
          <>
            <MonthStepper
              earlier="חודש קודם"
              later={isCurrent ? null : "חודש הבא"}
              onBand
              onStep={(delta) => {
                const next = shiftMonthKey(monthKey, delta);
                if (next <= currentKey) onMonth(next);
              }}
            >
              <span className="ui-band-month-name">{monthName}</span>
            </MonthStepper>
            <p className="ui-band-label t-line2">{isCurrent ? "תזרים הפרויקטים · עד היום" : "תזרים הפרויקטים · חודש סגור"}</p>
            <div className="ui-project-profits t-detail">
              <p>
                <Amount agorot={net} currency={base} loss={net < 0n} size="hero" compact />
              </p>
            </div>
            <div className="ui-project-band-pair">
              {(["in", "out"] as const).map((side) => (
                <span key={side} className="ui-band-row-link">
                  <span className="ui-band-row-label">{side === "in" ? "נכנס" : "יצא"}</span>
                  <span className="ui-band-row-amount">
                    <Amount agorot={BigInt(side === "in" ? totals.in : totals.out)} currency={base} presentation="detail" size="list" />
                  </span>
                </span>
              ))}
            </div>
            <span ref={setBandMark} className="ui-compact-mark" aria-hidden="true" />
          </>
        )}
      />
      <CompactBar
        title="פרויקטים"
        tone="band"
        shown={barShown}
        centre={(
          <span className="ui-compact-bar-centre">
            <span className="ui-compact-bar-centre-title">{`פרויקטים · ${monthName}`}</span>
            <span className="ui-compact-bar-centre-net">
              <bdi dir="ltr">{formatAmountText(net, base)}</bdi>
            </span>
          </span>
        )}
        dock={control(true)}
        docked={docked}
      />
      <div className="ui-projects-body">
        <div className="ui-page-pad">
          <AttentionCards rows={attention} storageKey="projects" />
        </div>
        <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
        <div className="ui-page-pad ui-projects-filter">
          <DockSlot docked={docked}>{control(false)}</DockSlot>
        </div>
        {groups.length === 0 ? (
          <p className="ui-page-pad ui-projects-none t-line2">{filter === "finished" ? "עוד אין פרויקטים שהסתיימו." : "אין פרויקטים פעילים."}</p>
        ) : groups.map((group) => (
          <section key={group.kind} className="ui-month" aria-labelledby={`projects-${group.kind}`}>
            <GroupHead
              id={`projects-${group.kind}`}
              title={group.title}
              summary={<><bdi dir="ltr">{String(group.rows.length)}</bdi> · <bdi dir="ltr">{formatAmountText(BigInt(group.net), base)}</bdi></>}
            />
            <List>
              {group.rows.map((row) => (
                <ProjectCashRowItem key={row.id} row={row} currency={base} search={search} />
              ))}
            </List>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * One project's row: initials, name, its type and status, and this month's cash. A finished one shows its
 * final result, named רווח כולל, with a tick. The overhead project's circle is dashed.
 */
function ProjectCashRowItem({ row, currency, search }: { row: ProjectCashRow; currency: string; search: string }) {
  const href = `/projects/${row.id}${search}`;
  if (row.status === "finished") {
    return (
      <ListRow
        variant="project"
        title={row.name}
        hint={row.type ?? "הסתיים"}
        icon={<span className="ui-row-initials ui-row-done" aria-hidden="true"><CheckIcon size={18} /></span>}
        agorot={BigInt(row.profit_all_minor)}
        currency={currency}
        amountDirection={row.profit_all_minor > 0 ? "income" : undefined}
        endSub="רווח כולל"
        href={href}
      />
    );
  }
  const net = netIn(row.cash, currency);
  if (row.is_overhead) {
    return (
      <ListRow
        variant="project"
        title={row.name}
        hint="תקורה · לא פרויקט"
        icon={<span className="ui-row-initials ui-row-dashed" aria-hidden="true"><HomeIcon size={18} /></span>}
        agorot={BigInt(net)}
        signed
        currency={currency}
        href={href}
      />
    );
  }
  // Cash outside the base currency lists each line; the order stays on the base currency.
  const lines = row.cash.map((line) => ({ minor: BigInt(line.net_minor), currency: line.currency }));
  const elsewhere = lines.length > 1 || lines.some((line) => line.currency !== currency);
  return (
    <ListRow
      variant="project"
      title={row.name}
      // FLOW-961: the flag leads the line, so a long type never cuts it off.
      // A long type ends in an ellipsis on one line (board V3-States, long content).
      hint={<span className="ui-proj-hint-line" data-clip-ok="">{isOverBudget(row) ? <span className="ui-proj-over">מעל התקציב · </span> : null}{projectMeta(row)}</span>}
      icon={<Avatar name={row.name} fallback="person" />}
      agorot={BigInt(net)}
      currency={currency}
      amounts={elsewhere ? lines : undefined}
      signed
      href={href}
    />
  );
}
