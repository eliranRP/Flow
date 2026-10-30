import "../ui/lazy.css";
import { type Dashboard, type ProjectCashRow, type ProjectsCashMonth } from "@flow/shared";
import { useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useOpenFromQuery } from "../open-from-query";
import { cashMonthName } from "../cash";
import { companyPartNet, type CompanyNextMonth } from "../company-next-month";
import { useProjectsCashMonth } from "../project-cash";
import { netIn, orderActiveProjects, overheadRow, isOverBudget, projectMeta, unassignedCountLabel } from "../project-list";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useDashboardQuery } from "../use-books";
import { israelToday } from "../ui/date-math";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { CompactBar } from "../ui/compact-bar";
import { useScrolledPast } from "../ui/screen-header";
import { Amount, formatAmount } from "../ui/amount";
import { CheckIcon, HomeIcon, PlusIcon, SearchIcon } from "../ui/icons";
import { Avatar } from "../ui/avatar";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ProjectsSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { CompanyCashCard, thisMonthCashOut, useCompanyCashNextMonth, type CompanyCashNextMonth } from "./company-cash-next-month";
import type { HomeNextMonthSample } from "./home-next-month";
import { useCashMonthsQuery } from "../use-cash";
import { ProjectFormSheet } from "./project-form-sheet";

/**
 * FLOW-445: the Projects tab. Rows are this month's cash per project, the overhead row last. FLOW-990: the
 * company's next month above the list, and each row's own next month under its figure.
 */
export function ProjectsScreen({
  sample,
  cashSample,
  nextSample,
  today: sampleToday,
  finishedOpen: openFinished = false,
}: {
  sample?: Dashboard;
  cashSample?: ProjectsCashMonth;
  /** FLOW-990: the next month's reads and the company's cash months, as they would come back; with `today`, the day they are from. */
  nextSample?: HomeNextMonthSample;
  today?: string;
  /** Stories and the proof build open הסתיימו at once. */
  finishedOpen?: boolean;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery(sample == null);
  const cash = useProjectsCashMonth();
  const holdWrites = useHoldWrites();
  const location = useLocation();
  const [open, setOpenState] = useState(false);
  const adopt = useRef(false);
  // Back closes the sheet. A quick action opened over this page adopts its entry (one Back closes).
  const setOpen = useSheetHistory("project-new", open, setOpenState, undefined, adopt);
  // FLOW-331: + → פרויקט חדש lands here with ?new=project.
  useOpenFromQuery("project", !holdWrites, (sameEntry) => {
    adopt.current = sameEntry;
    setOpen(true);
  });
  const finishedFromRoute = (location.state as { finishedOpen?: boolean } | null)?.finishedOpen === true;
  const [finishedOpen, setFinishedOpen] = useState(finishedFromRoute || openFinished);
  const month = cashSample ?? cash.data;
  const today = sampleToday ?? israelToday();
  // FLOW-990: the forecast waits for the list's currency; a sample list with no forecast sample reads nothing.
  const next = useCompanyCashNextMonth(month?.base_currency ?? "ILS", today, month != null && cashSample == null, nextSample?.next);
  // This month's cash out so far, for the card's expense caption, as Home reads it (usually cached by Home).
  const companyCash = useCashMonthsQuery(nextSample == null && cashSample == null);
  const thisMonthOut = thisMonthCashOut(nextSample?.cash ?? companyCash.data ?? null, today, month?.base_currency ?? "ILS");
  // The dashboard first, then the cash month: a pending or failed cash read is the screen's phase too.
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard.isPending || dashboard.isError || cashSample != null ? dashboard : cash);
  const sheet = (
    <ProjectFormSheet open={open} onOpenChange={setOpen} />
  );
  const empty = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader layout="stacked" title="פרויקטים" trailing={<span className="ui-header-slot" aria-hidden="true" />} className="ui-tab-root-head" />
      <div className="ui-state-empty flex min-h-0 flex-1 flex-col">
        <EmptyState
          icon={<HomeIcon />}
          title="עוד אין פרויקטים"
          body={holdWrites ? "פרויקטים מגיעים מ־SUMIT." : "פרויקט מרכז את ההכנסות וההוצאות של נכס או עבודה, ומראה אם הוא מרוויח."}
          action={holdWrites ? undefined : <Button onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
        />
      </div>
      {sheet}
    </div>
  );
  if (phase.kind === "empty" || (phase.kind === "ready" && (month?.projects.length ?? 0) === 0)) return empty;
  const activeCount = month?.projects.filter((row) => row.status === "active" && !row.is_overhead).length ?? 0;
  return (
    <>
      <ScreenState
        stacked
        headerClassName="ui-tab-root-head ui-projects-root-head"
        title="פרויקטים"
        // FLOW-961: one row, the title with search and the filled + (the screen's main action).
        titleAside={phase.kind !== "ready" ? <span className="ui-header-slot" aria-hidden="true" /> : (
          <span className="ui-projects-head-actions">
            <IconButton to={`/search${search}`} label="חיפוש">
              <SearchIcon />
            </IconButton>
            {holdWrites ? null : (
              <IconButton label="פרויקט חדש" className="ui-icon-btn-filled" onClick={() => { setOpen(true); }}>
                <PlusIcon />
              </IconButton>
            )}
          </span>
        )}
        subtitle={month ? `${String(activeCount)} פעילים · תזרים ${cashMonthName(month.month.slice(0, 7))} עד היום` : undefined}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); void cash.refetch(); }}
        loading={<ProjectsSkeleton />}
      >
        {month ? (
          <ProjectsBody
            month={month}
            search={search}
            finishedOpen={finishedOpen}
            setFinishedOpen={setFinishedOpen}
            onNew={holdWrites ? undefined : () => { setOpen(true); }}
            next={next}
            today={today}
            thisMonthOut={thisMonthOut}
          />
        ) : null}
      </ScreenState>
      {sheet}
    </>
  );
}

function ProjectsBody({
  month,
  search,
  finishedOpen,
  setFinishedOpen,
  onNew,
  next,
  today,
  thisMonthOut,
}: {
  month: NonNullable<ProjectsCashMonth>;
  search: string;
  finishedOpen: boolean;
  setFinishedOpen: (value: boolean) => void;
  /** Undefined while writes are held: the compact bar then has no פרויקט חדש. */
  onNew?: () => void;
  next: CompanyCashNextMonth;
  today: string;
  thisMonthOut: bigint;
}) {
  const base = month.base_currency;
  const [titleEnd, setTitleEnd] = useState<HTMLSpanElement | null>(null);
  const past = useScrolledPast(titleEnd, true);
  const active = orderActiveProjects(month.projects, base);
  const overhead = overheadRow(month);
  const finished = month.projects.filter((row) => row.status === "finished" && !row.is_overhead);
  const unassignedNet = netIn(month.unassigned.cash, base);
  return (
    <>
      <span ref={setTitleEnd} className="ui-compact-mark" aria-hidden="true" />
      {month.unassigned.count > 0 ? (
        <div className="ui-page-pad ui-projects-unassigned">
          <Button variant="link" to={`/review${search}`} chevron>
            {unassignedCountLabel(month.unassigned.count)} · <bdi dir="ltr">{formatAmount(BigInt(unassignedNet), "detail", base)}</bdi> · לשיוך
          </Button>
        </div>
      ) : null}
      <div className="ui-page-pad ui-projects-next">
        <CompanyCashCard next={next} currency={base} today={today} thisMonthOut={thisMonthOut} />
      </div>
      <div className="ui-page-pad ui-projects-head">
        <h2>פעילים</h2>
        <span className="ui-muted">לפי פעילות</span>
      </div>
      <List>
        {active.map((row) => (
          <ProjectCashRowItem key={row.id} row={row} currency={base} search={search} next={nextFigure(next.forecast, row.id, base)} />
        ))}
        {overhead ? (
          <ListRow
            variant="project"
            title={overhead.name}
            hint="תקורה · לא פרויקט"
            icon={<span className="ui-row-initials ui-row-dashed" aria-hidden="true"><HomeIcon size={18} /></span>}
            agorot={BigInt(netIn(overhead.cash, base))}
            signed
            currency={base}
            href={`/projects/${overhead.id}${search}`}
            endSub={nextFigure(next.forecast, null, base)}
          />
        ) : null}
      </List>
      {finished.length > 0 ? (
        <>
          <button type="button" className="ui-page-pad ui-projects-head ui-projects-finished-toggle" aria-expanded={finishedOpen} onClick={() => { setFinishedOpen(!finishedOpen); }}>
            <h2>הסתיימו · <bdi dir="ltr">{String(finished.length)}</bdi></h2>
            <span className="ui-projects-toggle-word">{finishedOpen ? "הסתר" : "הצג"}</span>
          </button>
          {finishedOpen ? (
            <List>
              {finished.map((row) => (
                <ProjectCashRowItem key={row.id} row={row} currency={base} search={search} finished />
              ))}
            </List>
          ) : null}
        </>
      ) : null}
      <CompactBar
        title="פרויקטים"
        size="detail"
        shown={past}
        actions={(
          <>
            <IconButton to={`/search${search}`} label="חיפוש">
              <SearchIcon />
            </IconButton>
            {onNew ? (
              <IconButton label="פרויקט חדש" onClick={onNew}>
                <PlusIcon />
              </IconButton>
            ) : null}
          </>
        )}
      />
    </>
  );
}

/**
 * FLOW-990: a row's next month under its figure, the צפי tag and the cash net (a project's part, or the general
 * costs' on the overhead row). Undefined while the forecast is out or the part expects nothing.
 */
function nextFigure(forecast: CompanyNextMonth | null, projectId: string | null, currency: string) {
  const net = forecast == null ? null : companyPartNet(forecast, projectId);
  if (net == null) return undefined;
  return (
    <span className="ui-proj-next">
      <span className="ui-fc-tag">צפי</span>
      <Amount agorot={net} currency={currency} direction={net > 0n ? "income" : undefined} />
    </span>
  );
}

/** One project's row: initials, name, its type and status, and this month's cash (or its profit when finished). */
function ProjectCashRowItem({ row, currency, search, finished = false, next }: { row: ProjectCashRow; currency: string; search: string; finished?: boolean; next?: ReactNode }) {
  const net = netIn(row.cash, currency);
  // Cash outside the base currency lists each line; the order stays on the base currency.
  const lines = finished ? [] : row.cash.map((line) => ({ minor: BigInt(line.net_minor), currency: line.currency }));
  const elsewhere = lines.length > 1 || lines.some((line) => line.currency !== currency);
  const over = !finished && isOverBudget(row);
  // The board's finished row: a tick, the owner's own words ("flip · נמכר ביוני 2026"), and the final result in whole
  // dollars, named רווח כולל. FLOW-961: at full contrast, not dimmed.
  const hint = finished ? (row.type ?? "הסתיים") : projectMeta(row);
  if (finished) {
    return (
      <ListRow
        variant="project"
        title={row.name}
        hint={hint}
        icon={<span className="ui-row-initials ui-row-done" aria-hidden="true"><CheckIcon size={18} /></span>}
        agorot={BigInt(row.profit_all_minor)}
        currency={currency}
        amountDirection={row.profit_all_minor > 0 ? "income" : undefined}
        endSub="רווח כולל"
        href={`/projects/${row.id}${search}`}
      />
    );
  }
  return (
    <ListRow
      variant="project"
      title={row.name}
      // FLOW-961: the flag leads the line, so a long type never cuts it off.
      hint={<span className="ui-proj-hint-line">{over ? <span className="ui-proj-over">מעל התקציב · </span> : null}{hint}</span>}
      icon={<Avatar name={row.name} fallback="person" />}
      agorot={BigInt(net)}
      currency={currency}
      amounts={elsewhere ? lines : undefined}
      signed
      href={`/projects/${row.id}${search}`}
      endSub={next}
    />
  );
}
