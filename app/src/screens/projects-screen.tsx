import { type Dashboard, type ProjectCashRow, type ProjectsCashMonth } from "@flow/shared";
import { useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { useOpenFromQuery } from "../open-from-query";
import { cashMonthName } from "../cash";
import { useProjectsCashMonth } from "../project-cash";
import { netIn, orderActiveProjects, overheadRow, isOverBudget, projectMeta, unassignedCountLabel } from "../project-list";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useDashboardQuery } from "../use-books";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { CompactBar } from "../ui/compact-bar";
import { useScrolledPast } from "../ui/screen-header";
import { formatAmount } from "../ui/amount";
import { HomeIcon, PlusIcon, ProjectsIcon, SearchIcon } from "../ui/icons";
import { Avatar } from "../ui/avatar";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ProjectsSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { TextLink } from "../ui/text-link";
import { ProjectFormSheet } from "./project-form-sheet";

/** FLOW-445: the Projects tab. Rows are this month's cash per project, the overhead row last. */
export function ProjectsScreen({ sample, cashSample }: { sample?: Dashboard; cashSample?: ProjectsCashMonth } = {}) {
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
  const [finishedOpen, setFinishedOpen] = useState(finishedFromRoute);
  const month = cashSample ?? cash.data;
  // The dashboard first, then the cash month: a pending or failed cash read is the screen's phase too.
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard.isPending || dashboard.isError || cashSample != null ? dashboard : cash);
  const sheet = (
    <ProjectFormSheet open={open} onOpenChange={setOpen} />
  );
  const empty = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="פרויקטים" />
      <EmptyState
        icon={<ProjectsIcon />}
        title="עוד אין פרויקטים"
        body={holdWrites ? "פרויקטים מגיעים מ־SUMIT." : "פרויקטים מגיעים מ־SUMIT, ואפשר גם לפתוח אחד כאן."}
        action={holdWrites ? undefined : <Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
      />
      {sheet}
    </div>
  );
  if (phase.kind === "empty" || (phase.kind === "ready" && (month?.projects.length ?? 0) === 0)) return empty;
  const activeCount = month?.projects.filter((row) => row.status === "active" && !row.is_overhead).length ?? 0;
  return (
    <>
      <ScreenState
        stacked
        headerClassName="ui-tab-root-head"
        title="פרויקטים"
        leading={holdWrites ? undefined : <TextLink tone="accent" chevron={false} onClick={() => { setOpen(true); }}>+ פרויקט חדש</TextLink>}
        trailing={(
          <IconButton to={`/search${search}`} label="חיפוש">
            <SearchIcon />
          </IconButton>
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
}: {
  month: NonNullable<ProjectsCashMonth>;
  search: string;
  finishedOpen: boolean;
  setFinishedOpen: (value: boolean) => void;
  /** Undefined while writes are held: the compact bar then has no פרויקט חדש. */
  onNew?: () => void;
}) {
  const base = month.base_currency;
  const titleEnd = useRef<HTMLSpanElement>(null);
  const past = useScrolledPast(titleEnd, true);
  const active = orderActiveProjects(month.projects, base);
  const overhead = overheadRow(month);
  const finished = month.projects.filter((row) => row.status === "finished" && !row.is_overhead);
  const unassignedNet = netIn(month.unassigned.cash, base);
  return (
    <>
      <span ref={titleEnd} className="ui-compact-mark" aria-hidden="true" />
      {month.unassigned.count > 0 ? (
        <div className="ui-page-pad ui-projects-unassigned">
          <TextLink to={`/review${search}`} tone="accent">
            {unassignedCountLabel(month.unassigned.count)} · <bdi dir="ltr">{formatAmount(BigInt(unassignedNet), "detail", base)}</bdi> · לשיוך
          </TextLink>
        </div>
      ) : null}
      <div className="ui-page-pad ui-projects-head">
        <h2>פעילים</h2>
        <span className="ui-muted">לפי פעילות</span>
      </div>
      <List>
        {active.map((row) => (
          <ProjectCashRowItem key={row.id} row={row} currency={base} search={search} />
        ))}
        {overhead ? (
          <ListRow
            variant="project"
            title="הוצאות כלליות"
            hint="תקורה · לא פרויקט"
            icon={<span className="ui-row-initials ui-row-dashed" aria-hidden="true"><HomeIcon size={18} /></span>}
            agorot={BigInt(netIn(overhead.cash, base))}
            signed
            currency={base}
            href={`/projects/${overhead.id}${search}`}
          />
        ) : null}
      </List>
      {finished.length > 0 ? (
        <>
          <button type="button" className="ui-page-pad ui-projects-head ui-projects-finished-toggle" aria-expanded={finishedOpen} onClick={() => { setFinishedOpen(!finishedOpen); }}>
            <h2>הסתיימו · <bdi dir="ltr">{String(finished.length)}</bdi></h2>
            <span className="ui-text-link">{finishedOpen ? "הסתר" : "הצג"}</span>
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
            {onNew ? (
              <IconButton label="פרויקט חדש" onClick={onNew}>
                <PlusIcon />
              </IconButton>
            ) : null}
            <IconButton to={`/search${search}`} label="חיפוש">
              <SearchIcon />
            </IconButton>
          </>
        )}
      />
    </>
  );
}

/** One project's row: initials, name, its type and status, and this month's cash (or its profit when finished). */
function ProjectCashRowItem({ row, currency, search, finished = false }: { row: ProjectCashRow; currency: string; search: string; finished?: boolean }) {
  const net = netIn(row.cash, currency);
  // Cash outside the base currency lists each line; the order stays on the base currency.
  const lines = finished ? [] : row.cash.map((line) => ({ minor: BigInt(line.net_minor), currency: line.currency }));
  const elsewhere = lines.length > 1 || lines.some((line) => line.currency !== currency);
  const over = !finished && isOverBudget(row);
  const hint = projectMeta(row);
  return (
    <ListRow
      variant="project"
      title={row.name}
      hint={over ? <>{hint}<span className="ui-proj-over"> · מעל התקציב</span></> : hint}
      icon={<Avatar name={row.name} fallback="person" />}
      agorot={BigInt(finished ? row.profit_all_minor : net)}
      currency={currency}
      amounts={elsewhere ? lines : undefined}
      signed
      href={`/projects/${row.id}${search}`}
      className={finished ? "ui-proj-finished" : undefined}
    />
  );
}
