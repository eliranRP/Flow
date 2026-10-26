import { type CashMonths, type ProjectCashRow, type ProjectDetail } from "@flow/shared";
import { useCompanyCurrency } from "../company-currency";
import { projectExpenseMinor, projectRows } from "../by-currency";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { overheadHint } from "../overhead";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { type PeriodChoice } from "../period";
import { useProjectPeriod, withPeriodSearch } from "../project-period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useProjectQuery } from "../use-books";
import { useProjectCashMonthsQuery, useProjectsCashMonth } from "../project-cash";
import { useNextMonthForecast, type NextMonthSample } from "../project-next-month-query";
import { cashForecast } from "../project-next-month";
import { assertNoError, useWrite } from "../use-write";
import { Amount } from "../ui/amount";
import { BudgetCard, BudgetEmptyCard } from "../ui/budget-card";
import { EmptyState } from "../ui/empty-state";
import { BackButton } from "../ui/back";
import { BandLoadFailed, useOnline } from "../ui/band-states";
import { IconButton } from "../ui/icon-button";
import { DocumentIcon, MoreIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { FocusTitle } from "../ui/focus-title";
import { ScreenHeader } from "../ui/screen-header";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { israelToday } from "../ui/date-math";
import { ReservedMenuSlot, useBlockedPreview } from "./screen-shared";
import { useProjectGroups, type ProjectGroups } from "./project-group-sheets";
import { investmentLoansRow, ProjectCashOverview } from "./project-cash-screens";
import { ProjectFormSheet } from "./project-form-sheet";
import { ProjectMenu } from "./project-menu";
import { projectAttentionRows, useProjectRecurring, type ProjectRecurringSample } from "./project-attention";
import { toProjectInvestment, type ProjectInvestment } from "./project-investment-data";

function ProjectLoading({ search, example }: { search: string; example?: ReactNode }) {
  const holdWrites = useHoldWrites();
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <TopBand
        wordmark={false}
        example={example}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        trailing={holdWrites ? <ReservedMenuSlot /> : (
          <IconButton label="עוד" onBand onClick={() => { setMenu(true); }}>
            <MoreIcon />
          </IconButton>
        )}
        hero={
          <div className="ui-project-skel">
            <span className="ui-skel-project-title">
              <Skeleton tone="band" className="ui-skel-project-title-bar" />
            </span>
            <Skeleton tone="band" className="ui-skel-project-label" />
            {/* The loaded band ends at the figure, so the skeleton does too (FLOW-115: no shrink on load). */}
            <Skeleton tone="band" className="ui-skel-project-num" />
          </div>
        }
      />
      <div className="ui-page-pad ui-stack">
        <Skeleton width="lg" />
        <Skeleton width="md" />
      </div>
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ListSkeleton />
      {holdWrites ? null : (
        <Sheet open={menu} onOpenChange={setMenu} title="עוד">
          <p className="t-caption t-muted">הפרויקט עדיין נטען.</p>
        </Sheet>
      )}
    </div>
  );
}

const ALL_PERIOD: PeriodChoice = { kind: "all", from: null, to: null };

/**
 * FLOW-340 C: the overview, or one of the screens its rows open. FLOW-419: the overview is the
 * project's cash, and "profit" is the page the project used to open on.
 */
export type ProjectSection = "overview" | "investment";

export function ProjectDetailScreen({
  sample,
  example,
  sampleInvestment,
  sectionTo,
  sampleGroups,
  sampleCash,
  sampleRecurring,
  sampleMenuRow,
  sampleNext,
  sampleOfflineSince,
  now,
}: {
  sample?: NonNullable<ProjectDetail>;
  /** A sample project's late bills and changed charges, for Home's rows on the page (stories). */
  sampleRecurring?: ProjectRecurringSample;
  /** FLOW-419. A sample project's cash months; without it a sample project's cash is its by_currency, as this month. */
  sampleCash?: NonNullable<CashMonths>;
  /** Stories and tests pin the month names. */
  now?: Date;
  /** FLOW-961: a sample page drawn offline, its figures from this moment (stories). */
  sampleOfflineSince?: number;
  /** A sample project's next-month forecast reads; without it a sample project's chart has no forecast. */
  sampleNext?: NextMonthSample;
  /** A sample project's row for the ⋯ menu (its deletable flag); the menu reads no cash in a preview. */
  sampleMenuRow?: ProjectCashRow;
  /** FLOW-404. The השקעה data of a sample project; without it a sample project shows no investment. */
  sampleInvestment?: ProjectInvestment;
  example?: ReactNode;
  /** Dev fixtures send the overview's rows (and the sections' Back) here. Production builds the project routes. */
  sectionTo?: (section: ProjectSection) => string;
  /** FLOW-360. A sample project's groups and its own, for the ⋯ menu's קבוצה row (stories). */
  sampleGroups?: ProjectGroups;
} = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  // The project's own period (decision 0141): it starts as Home's, and changing it leaves Home alone.
  const [period] = useProjectPeriod();
  const detail = useProjectQuery(sample ? "" : projectId, period);
  // FLOW-419: the project page opens on its cash, read beside the project (its name, investment and loans).
  const cash = useProjectCashMonthsQuery(sample ? "" : projectId);
  // Home's late bills (the company read Home already holds) and the project's changed charges. They
  // need only the project id, so they are read beside the project, not after it.
  const recurring = useProjectRecurring(projectId, sample == null, sampleRecurring);
  // FLOW-360: the project's group and the company's groups, for the ⋯ menu's קבוצה row.
  // FLOW-804: read once the project's own read has landed, so they never slow the page's paint.
  const liveGroups = useProjectGroups(projectId, sample == null && detail.data != null && !detail.isFetching);
  const groups = sampleGroups ?? liveGroups;
  // The profit since the project began: a read over every period, beside the page's own read.
  const lifetime = useProjectQuery(sample == null ? projectId : "", ALL_PERIOD);
  // The project's row (the same cached read the ⋯ menu uses): the month it began. It starts from the
  // Projects list's read, so a page opened from the list paints that row at once.
  const monthRows = useProjectsCashMonth(undefined, sample ? "" : projectId);
  const monthRow = sampleMenuRow ?? monthRows.data?.projects.find((row) => row.id === projectId);
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  // Next month's forecast, as the profit page and the צפי page read it: the currency of the project's
  // lifetime figures, read once the project's own read has landed (FLOW-804).
  const lifetimeProject = lifetime.data ?? sample ?? null;
  const forecastCurrency = lifetimeProject == null ? companyCurrency : projectRows(lifetimeProject, companyCurrency)[0]?.currency ?? companyCurrency;
  // The forecast waits for the lifetime read too, so it is never built first in the company's currency.
  const currencyPending = sample == null && detail.data != null && lifetime.data == null && lifetime.isPending && !lifetime.isPaused;
  const forecastLive = sample == null && detail.data != null && lifetime.data != null;
  const next = useNextMonthForecast(sample?.id ?? projectId, forecastCurrency, sampleNext, forecastLive);
  // Decision 0196: the page is about cash, so its card and chart take the forecast in cash terms (the loans'
  // principal due next month included), derived from the one forecast the צפי page shows.
  const nextMonth = {
    forecast: next.forecast == null ? null : cashForecast(next.forecast),
    loading: currencyPending || (forecastLive && next.pending && !next.paused && !next.failed),
    currency: forecastCurrency,
    categories: next.categories,
    today: next.today,
  };
  const blocked = useBlockedPreview();
  // FLOW-804: a page showing a read (its last one, or the one saved on the phone) keeps it when a
  // refresh fails; the server is slow or away, and the figures it has are still the project's.
  const detailPhase = sample || (preview === "off" && detail.data != null) ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const cashRead = sample || (preview === "off" && cash.data != null)
    ? ({ kind: "ready" } as const)
    : screenPhase(preview, cash);
  // FLOW-419: the page paints the project's name from its own read while the cash read is still out.
  const cashPhase = cashRead.kind === "loading" ? ({ kind: "ready" } as const) : cashRead;
  const phase = detailPhase.kind === "ready" ? cashPhase : detailPhase;
  const [overheadOn, setOverheadOn] = useState(sample?.after_overhead === true);
  const wantedOverhead = useRef(false);
  useEffect(() => {
    if (sample) return;
    if (detail.data) setOverheadOn(detail.data.after_overhead === true);
  }, [sample, detail.data]);
  const saveOverhead = useWrite({
    failure: "לא הצלחנו לשמור את התצוגה.",
    keys: ["project", "dashboard", "profit-months"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current, p_project_id: projectId }));
    },
  });
  const holdWrites = useHoldWrites();
  const online = useOnline();
  if (phase.kind === "loading") {
    return <ProjectLoading search={search} example={example} />;
  }
  if (phase.kind === "error") {
    // FLOW-961: the band stays, as on Home: the project's name, what happened, נסו שוב and צריך עזרה?.
    const name = detail.data?.name ?? monthRow?.name;
    return (
      <BandLoadFailed
        title={name == null ? "הפרויקט לא נטען" : `${name} לא נטען`}
        offline={phase.offline || !online}
        leading={<BackButton fallback={`/projects${search}`} text="פרויקטים" onBand />}
        onRetry={() => {
          void detail.refetch();
          void cash.refetch();
        }}
      />
    );
  }
  if (phase.kind === "empty") return <LegacyEmptyProject />;
  const project = sample ?? detail.data;
  if (!project) {
    return <ScreenHeader title="פרויקט" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  const periodQuery = withPeriodSearch(search, period);
  const sectionHref = (target: ProjectSection) => sectionTo?.(target)
    ?? (target === "overview" ? `/projects/${project.id}${periodQuery}` : `/projects/${project.id}/${target}${periodQuery}`);
  const stateLine = projectStateLine(project);
  const investmentData = sampleInvestment ?? toProjectInvestment(project);
  const overhead = (
    <Toggle
      label="רווח אחרי הוצאות כלליות"
      hint={overheadHint(overheadOn, {
        available: project.overhead_weighted === true,
        shareAgorot: project.base_currency != null && project.base_currency !== "ILS"
          ? project.overhead_share_minor
          : project.overhead_share_agorot,
        currency: project.base_currency ?? "ILS",
      })}
      checked={overheadOn}
      disabled={holdWrites}
      onChange={(checked) => {
        if (holdWrites) return;
        if (sample) {
          setOverheadOn(checked);
          return;
        }
        if (blocked()) return;
        const previous = overheadOn;
        setOverheadOn(checked);
        wantedOverhead.current = checked;
        saveOverhead.mutate(undefined, { onError: () => { setOverheadOn(previous); } });
      }}
    />
  );
  const menu = holdWrites ? <ReservedMenuSlot /> : (
    <ProjectMenu
      projectId={project.id}
      name={project.name}
      budget={project.budget_agorot ?? null}
      finished={project.status === "finished"}
      groups={groups}
      sample={sample != null}
      sampleRow={sampleMenuRow}
      overhead={overhead}
      investmentTo={sectionHref("investment")}
      hasInvestment={investmentLoansRow(investmentData, project) != null}
    />
  );
  const cashData = sampleCash ?? (sample ? sampleCashOf(sample, now) : cash.data) ?? null;
  return (
    <ProjectCashOverview
      project={project}
      data={cashData}
      search={search}
      investmentData={investmentData}
      investmentHref={sectionHref("investment")}
      stateLine={stateLine}
      menu={menu}
      budget={<ProjectBudget project={project} spentAgorot={absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot)} />}
      firstMonth={monthRow?.first_month?.slice(0, 7) ?? null}
      fresh={monthRow != null && monthRow.first_month == null}
      sinceProfit={(lifetime.data ?? (sample ? project : null)) == null ? null : projectRows(lifetime.data ?? project, companyCurrency).map((row) => ({ currency: row.currency, minor: row.profit_minor }))}
      attention={projectAttentionRows({
        projectId: project.id,
        pending: project.pending_count ?? 0,
        late: recurring.late,
        changes: recurring.changes,
        search,
      })}
      nextMonth={nextMonth}
      // FLOW-961: offline, the page keeps its last read and says, in the band, which moment it is from.
      offlineSince={sample ? sampleOfflineSince ?? null : online || preview !== "off" ? null : cash.dataUpdatedAt || detail.dataUpdatedAt}
      example={example}
      now={now}
    />
  );
}

/**
 * FLOW-419: a sample project with no sample cash shows its figures as this month's cash, so the
 * stories and dev routes that pass only a project still draw the page.
 */
function sampleCashOf(project: NonNullable<ProjectDetail>, now = new Date()): NonNullable<CashMonths> {
  const rows = projectRows(project, project.base_currency ?? "ILS");
  const month = `${israelToday(now).slice(0, 7)}-01`;
  return {
    basis: "paid",
    base_currency: rows[0]?.currency ?? "ILS",
    months: [{
      month,
      by_currency: rows.map((row) => ({
        currency: row.currency,
        in_minor: row.income_minor,
        out_minor: projectExpenseMinor(row),
        net_minor: row.income_minor - projectExpenseMinor(row),
        profit_minor: row.profit_minor,
        excluded_count: 0,
        excluded_in_minor: 0n,
        excluded_out_minor: 0n,
        not_in_profit_categories: [],
      })),
    }],
  };
}

/** The line under the project's name: only a state other than active ("הסתיים"), else nothing. */
export function projectStateLine(project: Pick<NonNullable<ProjectDetail>, "state_label" | "status">): string | null {
  const label = project.state_label ?? (project.status === "finished" ? "הסתיים" : null);
  return label == null || label === "" || label === "פעיל" ? null : label;
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        hero={
          <>
            <FocusTitle className="t-title">פרויקט</FocusTitle>
            <p className="ui-band-label t-line2">רווח</p>
            <p className="t-detail"><Amount agorot={0n} /></p>
          </>
        }
      />
      <EmptyState
        icon={<DocumentIcon />}
        title="אין עדיין תנועות"
        body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן."
      />
    </div>
  );
}

/**
 * FLOW-445: the budget card when a budget is set. FLOW-961: with none, a dashed card in its place whose
 * הוספת תקציב opens the edit sheet at the budget.
 */
function ProjectBudget({ project, spentAgorot }: { project: NonNullable<ProjectDetail>; spentAgorot: bigint }) {
  const [editing, setEditing] = useState(false);
  // The owner's type text is on the month's row (the same cached read the menu uses).
  const type = useProjectsCashMonth(undefined, project.id).data?.projects.find((row) => row.id === project.id)?.type ?? null;
  const budget = project.budget_agorot ?? null;
  const currency = useCompanyCurrency();
  return (
    <>
      {budget == null ? (
        <BudgetEmptyCard onAdd={() => { setEditing(true); }} />
      ) : (
        <BudgetCard spentMinor={spentAgorot} budgetMinor={budget} currency={currency} onEdit={() => { setEditing(true); }} />
      )}
      <ProjectFormSheet open={editing} onOpenChange={setEditing} focusBudget={budget == null} project={{ id: project.id, name: project.name, type, budget, status: project.status }} />
    </>
  );
}
