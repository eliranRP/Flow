import "../ui/lazy.css";
import { formatAmountText, type CashLine, type CashMonths, type ProjectCashRow, type ProjectDetail } from "@flow/shared";
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
import { useProjectCashMonthLinesQuery, useProjectCashMonthsQuery, useProjectsCashMonth } from "../project-cash";
import { type NextMonthSample } from "../project-next-month-query";
import { useProjectNextMonth } from "../next-month-for-project";
import { cashForecast } from "../project-next-month";
import { assertNoError, useWrite } from "../use-write";
import { Amount } from "../ui/amount";
import { BudgetCard, BudgetEmptyCard } from "../ui/budget-card";
import { EmptyState } from "../ui/empty-state";
import { BackButton } from "../ui/back";
import { BandLoadFailed, useOnline } from "../ui/band-states";
import { IconButton } from "../ui/icon-button";
import { DocumentIcon, MoreIcon } from "../ui/icons";
import { FocusTitle } from "../ui/focus-title";
import { ScreenHeader } from "../ui/screen-header";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { Card } from "../ui/card";
import { List, ListRow } from "../ui/list-row";
import { HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { useForecastOverrides, useForecastSkip } from "../forecast-skip";
import { ReservedMenuSlot, useBlockedPreview } from "./screen-shared";
import { useProjectGroups, type ProjectGroups } from "./project-group-sheets";
import { investmentLoansRow, ProjectCashOverview, ProjectReportsLink } from "./project-cash-screens";
import { LineGroupsSkeleton } from "./project-skeletons";
import type { ProjectLink } from "./project-page-cards";
import { cashMonthName } from "../cash";
import { resolveProjectKind } from "../project-list";
import { useRecurringScheduleQuery, type ScheduleRow } from "../recurring-schedule";
import { InvestmentSummary } from "../ui/investment-card";
import { ProjectFormSheet } from "./project-form-sheet";
import { ProjectMenu } from "./project-menu";
import { hideRow, isRowHidden, readHidden } from "../ui/attention-dismiss";
import { projectAttentionRows, useProjectRecurring, type ProjectRecurringSample } from "./project-attention";
import { toProjectInvestment, type ProjectInvestment } from "./project-investment-data";
import { useUtilityPayersQuery, useUtilityRefundsQuery, useUtilityStub } from "../utility-refunds";
import { refundCount } from "../utility-refund-view";

function ProjectLoading({ projectId, search, example }: { projectId: string; search: string; example?: ReactNode }) {
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
        trailing={(
          <div className="ui-project-band-end">
            <ProjectReportsLink projectId={projectId} search={search} />
            {holdWrites ? <ReservedMenuSlot /> : (
              <IconButton label="עוד" onBand onClick={() => { setMenu(true); }}>
                <MoreIcon />
              </IconButton>
            )}
          </div>
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
      {/* FLOW-1138: the links' card, then the month's lines, as the loaded page has them. */}
      <DelayedSkeleton>
        <div className="ui-project-stack" aria-hidden="true">
          <Card className="ui-project-card ui-project-links">
            <List>
              <ListRow variant="skeleton" />
              <ListRow variant="skeleton" />
            </List>
          </Card>
        </div>
        <LineGroupsSkeleton status={false} />
      </DelayedSkeleton>
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
  sampleSchedule,
  sampleLines,
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
  /** FLOW-1044: the company's recurring schedule and the month's lines as they would come back (stories). */
  sampleSchedule?: ScheduleRow[];
  sampleLines?: CashLine[];
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
  const next = useProjectNextMonth(sample?.id ?? projectId, forecastCurrency, sampleNext, forecastLive);
  // Decision 0196: the page is about cash, so its card and chart take the forecast in cash terms (the loans'
  // principal due next month included), derived from the one forecast the צפי page shows.
  const nextForecast = next.forecast == null ? null : cashForecast(next.forecast);
  const nextLoading = currencyPending || (forecastLive && next.pending && !next.paused && !next.failed);
  // FLOW-1044: the month's lines in groups: the project's recurring charges (Home's schedule read, usually
  // cached) and the month's lines, for the one-off group once they say which are recurring (FLOW-1035).
  const schedule = useRecurringScheduleQuery(sample == null && preview === "off");
  // FLOW-1081: this month's charges swipe out of the forecast and back, as on Home (the forecast's per-month item).
  const thisMonth = israelToday().slice(0, 7);
  const skipMonth = HEBREW_MONTHS[Number(thisMonth.slice(5, 7)) - 1] ?? thisMonth;
  const overrides = useForecastOverrides(thisMonth, sample == null && preview === "off");
  const forecastSkip = useForecastSkip(thisMonth, skipMonth, overrides.data ?? null);
  const linesMonth = cash.data?.months[0]?.month.slice(0, 7) ?? "";
  const monthLines = useProjectCashMonthLinesQuery(projectId, linesMonth, cash.data?.base_currency ?? "", sample == null && linesMonth !== "");
  // The schedule and the month's lines are read only for a live page (not a sample or a preview).
  const linesLive = sample == null && preview === "off";
  // FLOW-1135: the property's utilities (who pays each), and, once one is the tenant's, its bills not refunded.
  // A sample page (a story) reads them only through a story's stand-in client.
  const utilityStub = useUtilityStub();
  const utilityProject = sample?.id ?? projectId;
  const payers = useUtilityPayersQuery(utilityProject, sample == null ? detail.data != null : utilityStub);
  const utilities = payers.data ?? [];
  const refunds = useUtilityRefundsQuery(utilityProject, (sample == null || utilityStub) && utilities.some((item) => item.payer === "tenant"));
  const refundBills = refunds.data?.bills ?? [];
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
    return <ProjectLoading projectId={sample?.id ?? projectId} search={search} example={example} />;
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
  const fresh = monthRow != null && monthRow.first_month == null;
  const figures = investmentData.isOverhead ? null : investmentData.figures;
  const kind = resolveProjectKind({
    overhead: project.is_overhead === true,
    type: monthRow?.type ?? null,
    budget: project.budget_agorot != null,
    arv: figures?.arvMinor != null,
    value: figures?.valueMinor != null,
  });
  // FLOW-1135 (V3-Project-Rent-Utilities): a rental, or any project with utilities, has its חשבונות page.
  const utilityCount = refundCount(refundBills);
  const utilitiesTo = kind === "rental" || utilities.length > 0 ? `/projects/${project.id}/utilities/bills${search}` : null;
  // V3-J-B1-Project: what was paid back and what was not; the amount still missing when the bills read has one currency.
  const [missing] = utilityCount.totals;
  const utilityHint = utilityCount.notRefunded === 0
    ? "מה הוחזר ומה לא"
    : `מה הוחזר ומה לא · ${utilityCount.totals.length === 1 && missing != null ? `חסר ${formatAmountText(missing.minor, missing.currency, { detail: true })}` : `${String(utilityCount.notRefunded)} לא הוחזרו`}`;
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
      profitTo={`/projects/${project.id}/profit${withPeriodSearch(search, ALL_PERIOD)}`}
      utilitiesTo={utilitiesTo ?? undefined}
    />
  );
  const cashData = sampleCash ?? (sample ? sampleCashOf(sample, now) : cash.data) ?? null;
  const lifetimeRow = (lifetime.data ?? (sample ? project : null)) == null ? null : projectRows(lifetime.data ?? project, companyCurrency);
  // FLOW-1138: while the lifetime read is out, its row keeps its place with a bar for the figure.
  const lifetimeLoading = sample == null && lifetime.data == null && lifetime.isLoading;
  const investment = investmentLoansRow(investmentData, project);
  // A rental's card is its returns: the investment summary, once its purchase or value is entered.
  const summary = kind === "rental" && figures != null && (figures.purchaseMinor != null || figures.valueMinor != null) ? figures : null;
  const budgetMinor = project.budget_agorot ?? null;
  const kindCard = kind === "renovation" && (budgetMinor != null || (!fresh && project.status !== "finished"))
    ? <ProjectBudget project={project} type={monthRow?.type ?? null} spentAgorot={absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot)} />
    : kind === "client" && budgetMinor != null
      ? <ProjectBudget project={project} type={monthRow?.type ?? null} contract spentAgorot={lifetimeRow?.[0]?.income_minor ?? 0n} />
      : summary == null ? null : <InvestmentSummary figures={summary} href={sectionHref("investment")} />;
  const firstMonth = monthRow?.first_month?.slice(0, 7) ?? null;
  const links: ProjectLink[] = [
    ...(investment == null || summary != null ? [] : [{ id: "investment", title: "השקעה והלוואות", hint: investment.hint ?? "מחיר קנייה, שווי והלוואות", text: investment.figure, href: sectionHref("investment") }]),
    ...(lifetimeRow == null && !lifetimeLoading ? [] : [{
      id: "since",
      title: "רווח מתחילת הפרויקט",
      hint: firstMonth == null ? "כל התקופה עד היום" : `מאז ${cashMonthName(firstMonth, new Date(0))}`,
      figures: lifetimeRow?.map((row) => ({ currency: row.currency, minor: row.profit_minor })),
      loading: lifetimeRow == null,
      href: `/projects/${project.id}/profit${withPeriodSearch(search, ALL_PERIOD)}`,
    }]),
    ...(nextForecast == null && !nextLoading ? [] : [{
      id: "next",
      title: "צפוי לחודש הבא",
      hint: "תזרים צפוי, לפי החודשים הקודמים",
      loading: nextLoading,
      text: nextForecast == null ? undefined : formatAmountText(nextForecast.netMinor, next.currency, { plus: nextForecast.netMinor > 0n, direction: nextForecast.netMinor > 0n ? "income" : undefined }),
      href: `/projects/${project.id}/profit/next${search}`,
    }]),
    ...(utilitiesTo == null ? [] : [{
      id: "utilities",
      title: "חשבונות",
      hint: utilityHint,
      href: utilitiesTo,
    }]),
  ];
  return (
    <ProjectCashOverview
      project={project}
      data={cashData}
      search={search}
      stateLine={stateLine}
      menu={menu}
      kindCard={kindCard}
      links={links}
      fresh={fresh}
      schedule={sampleSchedule ?? schedule.data ?? (linesLive ? null : [])}
      lines={sampleLines ?? (monthLines.data != null
        ? [...monthLines.data.counted, ...monthLines.data.kept]
        // FLOW-1138: null while the month's lines are still to come; a month with none to read has none.
        : linesLive && !(cash.data != null && (linesMonth === "" || cash.data.base_currency === "")) ? null : [])}
      linesRetry={schedule.isError || monthLines.isError ? () => { void schedule.refetch(); void monthLines.refetch(); } : undefined}
      attention={projectAttentionRows({
        projectId: project.id,
        pending: project.pending_count ?? 0,
        late: recurring.late,
        changes: recurring.changes,
        search,
        budget: kind === "renovation" && budgetMinor != null ? { budget_minor: Number(budgetMinor), spent_minor: Number(absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot)) } : null,
        utilities: utilityCount,
      })}
      // FLOW-961: offline, the page keeps its last read and says, in the band, which moment it is from.
      offlineSince={sample ? sampleOfflineSince ?? null : offlineSinceOf(online || preview !== "off", cash.dataUpdatedAt, detail.dataUpdatedAt)}
      example={example}
      now={now}
      skip={sample != null || holdWrites || overrides.data == null ? undefined : { skipped: forecastSkip.skipped, base: companyCurrency, monthLabel: skipMonth, set: forecastSkip.set }}
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

/**
 * FLOW-961: when the page's figures are from, for the band's offline line: null online, in a preview,
 * or with no read time (0, nothing read yet).
 */
export function offlineSinceOf(onlineOrPreview: boolean, cashAt: number, detailAt: number): number | null {
  if (onlineOrPreview) return null;
  return cashAt || detailAt || null;
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

/** The hidden-card entry: one row, keyed once (the card has no count to change). */
const BUDGET_EMPTY_ROW = { id: "budget-empty", dismissKey: "budget-empty" };

/**
 * FLOW-445: the budget card when a budget is set. FLOW-961: with none, a dashed card in its place whose
 * הוספת תקציב opens the edit sheet at the budget.
 */
function ProjectBudget({ project, type, spentAgorot, contract = false }: { project: NonNullable<ProjectDetail>; type: string | null; spentAgorot: bigint; contract?: boolean }) {
  const [editing, setEditing] = useState(false);
  const budget = project.budget_agorot ?? null;
  const currency = useCompanyCurrency();
  // The owner (2026-11-05): the dashed card can be hidden on this device; עריכת פרטים in ⋯ still sets a budget.
  const hideKey = `project-budget:${project.id}`;
  const [hidden, setHidden] = useState(() => isRowHidden(readHidden(hideKey), BUDGET_EMPTY_ROW));
  return (
    <>
      {budget == null ? hidden ? null : (
        <BudgetEmptyCard
          onAdd={() => { setEditing(true); }}
          onHide={() => {
            hideRow(hideKey, BUDGET_EMPTY_ROW.id, BUDGET_EMPTY_ROW.dismissKey);
            setHidden(true);
          }}
        />
      ) : (
        <BudgetCard spentMinor={spentAgorot} budgetMinor={budget} currency={currency} contract={contract} onEdit={() => { setEditing(true); }} />
      )}
      <ProjectFormSheet open={editing} onOpenChange={setEditing} focusBudget={budget == null} project={{ id: project.id, name: project.name, type, budget, status: project.status }} />
    </>
  );
}
