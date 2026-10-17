import { formatAmountText, type CashMonths, type ProjectCashRow, type ProjectDetail } from "@flow/shared";
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
import { assertNoError, useWrite } from "../use-write";
import { Amount } from "../ui/amount";
import { BudgetCard } from "../ui/budget-card";
import { EmptyState } from "../ui/empty-state";
import { BackButton } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { DocumentIcon, MoreIcon } from "../ui/icons";
import { BandHero, SectionHead } from "../ui/layout";
import { TextLink } from "../ui/text-link";
import { List, ListRow } from "../ui/list-row";
import { FocusTitle } from "../ui/focus-title";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { israelToday } from "../ui/date-math";
import { ReservedMenuSlot, useBlockedPreview } from "./screen-shared";
import { useProjectGroups, type ProjectGroups } from "./project-group-sheets";
import { ProjectInvestmentSection, type ProjectInvestment } from "./project-investment";
import { ProjectCashOverview } from "./project-cash-screens";
import { ProjectFormSheet } from "./project-form-sheet";
import { ProjectMenu } from "./project-menu";
import { projectAttentionRows, useProjectRecurring, type ProjectRecurringSample } from "./project-attention";
import { toProjectInvestment } from "./project-investment-data";

function ProjectLoading({ search, example, pill = true }: { search: string; example?: ReactNode; pill?: boolean }) {
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
      >
        <BandHero>
          <div className="ui-project-skel">
            <span className="ui-skel-project-title">
              <Skeleton tone="band" className="ui-skel-project-title-bar" />
            </span>
            <Skeleton tone="band" className="ui-skel-project-label" />
            {/* FLOW-359 (A): the period pill sits between the label and the figure, as on Home.
                FLOW-419: only the profit page has it; the project page opens on its cash. */}
            {pill ? (
              <span className="ui-skel-project-period">
                <Skeleton tone="band" className="ui-skel-project-period-bar" />
              </span>
            ) : null}
            {/* The loaded band ends at the figure, so the skeleton does too (FLOW-115: no shrink on load). */}
            <Skeleton tone="band" className="ui-skel-project-num" />
          </div>
        </BandHero>
      </TopBand>
      <div className="ui-page-pad ui-stack">
        <Skeleton width="lg" />
        <Skeleton width="md" />
      </div>
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ListSkeleton />
      {holdWrites ? null : (
        <Sheet open={menu} onOpenChange={setMenu} title="עוד">
          <p className="t-hint">הפרויקט עדיין נטען.</p>
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
  section = "overview",
  sectionTo,
  sampleGroups,
  sampleCash,
  sampleRecurring,
  sampleMenuRow,
  now,
}: {
  sample?: NonNullable<ProjectDetail>;
  /** A sample project's late bills and changed charges, for Home's rows on the page (stories). */
  sampleRecurring?: ProjectRecurringSample;
  /** FLOW-419. A sample project's cash months; without it a sample project's cash is its by_currency, as this month. */
  sampleCash?: NonNullable<CashMonths>;
  /** Stories and tests pin the month names. */
  now?: Date;
  /** A sample project's row for the ⋯ menu (its deletable flag); the menu reads no cash in a preview. */
  sampleMenuRow?: ProjectCashRow;
  /** FLOW-404. The השקעה data of a sample project; without it a sample project shows no investment. */
  sampleInvestment?: ProjectInvestment;
  example?: ReactNode;
  /** FLOW-340 C. Which screen of the project this route draws. */
  section?: ProjectSection;
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
  const cash = useProjectCashMonthsQuery(sample ? "" : projectId, section === "overview");
  // Home's late bills and changed charges; the page shows the project's own. FLOW-912: read once the
  // project's own read has landed, like its groups, so two more reads stay out of the page's paint.
  const recurring = useProjectRecurring(
    projectId,
    sample == null && section === "overview" && detail.data != null && !detail.isFetching,
    sampleRecurring,
  );
  // FLOW-360: the project's group and the company's groups, for the ⋯ menu's קבוצה row.
  // FLOW-804: read once the project's own read has landed, so they never slow the page's paint.
  const liveGroups = useProjectGroups(projectId, sample == null && detail.data != null && !detail.isFetching);
  const groups = sampleGroups ?? liveGroups;
  // The profit since the project began: a read over every period, once the page's own read has landed.
  const lifetime = useProjectQuery(sample == null && section === "overview" && detail.data != null && !detail.isFetching ? projectId : "", ALL_PERIOD);
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const blocked = useBlockedPreview();
  // FLOW-804: a page showing a read (its last one, or the one saved on the phone) keeps it when a
  // refresh fails; the server is slow or away, and the figures it has are still the project's.
  const detailPhase = sample || (preview === "off" && detail.data != null) ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const cashRead = sample || section !== "overview" || (preview === "off" && cash.data != null)
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
  if (phase.kind === "loading") {
    return <ProjectLoading search={search} example={example} pill={section !== "overview"} />;
  }
  if (phase.kind === "error") {
    return (
      <ScreenState
        title="פרויקט"
        backTo={`/projects${search}`}
        phase={phase}
        onRetry={() => {
          void detail.refetch();
          if (section === "overview") void cash.refetch();
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
  if (section === "investment") {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        {/* FLOW-419: investment and loans share one page, one row from the project's cash. */}
        <ScreenHeader title="השקעה והלוואות" kicker={project.name} backTo={sectionHref("overview")} />
        <ProjectInvestmentSection project={project} sample={sampleInvestment} />
        {(project.loans ?? []).length === 0 ? null : (
          <>
            <SectionHead title="הלוואות" />
            <ProjectLoansList project={project} search={search} />
          </>
        )}
      </div>
    );
  }
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
      budget={<ProjectBudget project={project} spentAgorot={absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot)} part="card" />}
      budgetAdd={<ProjectBudget project={project} spentAgorot={0n} part="add" />}
      sinceProfit={(lifetime.data ?? (sample ? project : null)) == null ? null : projectRows(lifetime.data ?? project, companyCurrency).map((row) => ({ currency: row.currency, minor: row.profit_minor }))}
      attention={projectAttentionRows({
        projectId: project.id,
        pending: project.pending_count ?? 0,
        late: recurring.late,
        changes: recurring.changes,
        search,
      })}
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

/** The project's loans, each opening its own page; a paid-off loan says so. */
function ProjectLoansList({ project, search }: { project: NonNullable<ProjectDetail>; search: string }) {
  return (
    <List>
      {(project.loans ?? []).map((loan) => (
        <ListRow
          key={loan.id}
          variant="item"
          title={loan.name}
          hint={loan.balance_minor <= 0n ? "נפרעה" : undefined}
          meta={<bdi className="ui-num ui-project-row-figure" dir="ltr">{formatAmountText(loan.balance_minor, loan.currency)}</bdi>}
          href={`/loans/${loan.id}${search}`}
          chevron
        />
      ))}
    </List>
  );
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
      >
        <BandHero>
          <FocusTitle className="t-band-title">פרויקט</FocusTitle>
          <p className="ui-band-label t-label">רווח</p>
          <p className="t-display"><Amount agorot={0n} /></p>
        </BandHero>
      </TopBand>
      <EmptyState
        icon={<DocumentIcon />}
        title="אין עדיין תנועות"
        body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן."
      />
    </div>
  );
}

/** FLOW-445: the budget card with its edit sheet, on the expenses section. */
/** FLOW-445: the budget card when a budget is set; with none, a quiet "+ הוספת תקציב" at the end of the page. */
function ProjectBudget({ project, spentAgorot, part = "both" }: { project: NonNullable<ProjectDetail>; spentAgorot: bigint; part?: "card" | "add" | "both" }) {
  const [editing, setEditing] = useState(false);
  // The owner's type text is on the month's row (the same cached read the menu uses).
  const type = useProjectsCashMonth(undefined, project.id).data?.projects.find((row) => row.id === project.id)?.type ?? null;
  const budget = project.budget_agorot ?? null;
  const currency = useCompanyCurrency();
  // The overview draws the card first and the add link after the profit rows, as two parts of the one budget.
  if ((budget == null && part === "card") || (budget != null && part === "add")) return null;
  return (
    <>
      {budget == null ? (
        <TextLink tone="quiet" chevron={false} onClick={() => { setEditing(true); }}>+ הוספת תקציב</TextLink>
      ) : (
        <BudgetCard spentMinor={spentAgorot} budgetMinor={budget} currency={currency} onEdit={() => { setEditing(true); }} />
      )}
      <ProjectFormSheet open={editing} onOpenChange={setEditing} project={{ id: project.id, name: project.name, type, budget, status: project.status }} />
    </>
  );
}
