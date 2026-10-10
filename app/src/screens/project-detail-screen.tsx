import { formatAmountText, type ExpectedMonths, type ProjectCategoryMonthRow, type ProjectDetail } from "@flow/shared";
import { useCompanyCurrency } from "../company-currency";
import { profitSign, projectRows, type ProjectCurrencyRow } from "../by-currency";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { overheadHint, shownProfit } from "../overhead";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { periodPhrase, pillNamesPeriod, windowLabel } from "../period";
import { useProjectPeriod, withPeriodSearch } from "../project-period";
import { PeriodPicker } from "../ui/period-picker";
import { PeriodSwipe } from "../ui/period-swipe";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useProjectQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { BigNumber } from "../ui/big-number";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { EmptyState } from "../ui/empty-state";
import { BackButton } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { DocumentIcon, MoreIcon } from "../ui/icons";
import { BandHero, SectionHead } from "../ui/layout";
import { TextLink } from "../ui/text-link";
import { List, ListRow } from "../ui/list-row";
import { FocusTitle } from "../ui/focus-title";
import { BudgetBar } from "../ui/progress-bar";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { ReservedMenuSlot, useBlockedPreview } from "./screen-shared";
import { ProjectGroupSheets, NO_GROUP, useProjectGroups, type ProjectGroups } from "./project-group-sheets";
import { ProjectInvestmentSection, type ProjectInvestment } from "./project-investment";
import { ProjectCategories } from "./project-categories";
import { ProjectExpectedMonths } from "./project-expected-months";
import { investmentFigure, openLoans, ProjectOverviewRows } from "./project-overview";
import { ProjectTransactions } from "./project-transactions";
import { toProjectInvestment } from "./project-investment-data";

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
      >
        <BandHero>
          <div className="ui-project-skel">
            <span className="ui-skel-project-title">
              <Skeleton tone="band" className="ui-skel-project-title-bar" />
            </span>
            <Skeleton tone="band" className="ui-skel-project-label" />
            {/* FLOW-359 (A): the period pill sits between the label and the figure, as on Home. */}
            <span className="ui-skel-project-period">
              <Skeleton tone="band" className="ui-skel-project-period-bar" />
            </span>
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

function projectRowProfit(
  project: NonNullable<ProjectDetail>,
  row: ProjectCurrencyRow,
  overheadOn: boolean,
  singleCurrency: boolean,
): bigint {
  // The overhead share comes off the company currency's row only (0147).
  const base = project.base_currency ?? "ILS";
  if (base !== "ILS") {
    const share = project.overhead_share_minor;
    if (row.currency !== base || !overheadOn || project.overhead_weighted !== true || share == null) return row.profit_minor;
    return row.profit_minor - share;
  }
  if (row.currency === "ILS" && singleCurrency) {
    return shownProfit(
      overheadOn,
      project.overhead_weighted === true,
      project.profit_agorot,
      project.profit_after_overhead_agorot,
    );
  }
  if (row.currency === "ILS" && overheadOn && project.overhead_weighted === true && project.profit_after_overhead_agorot != null) {
    return project.profit_after_overhead_agorot;
  }
  return row.profit_minor;
}

/** FLOW-340 C: the overview, or one of the screens its rows open. */
export type ProjectSection = "overview" | "expenses" | "investment" | "loans" | "transactions";

function withParams(search: string, params: Record<string, string>): string {
  const next = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [key, value] of Object.entries(params)) next.set(key, value);
  return `?${next.toString()}`;
}

export function ProjectDetailScreen({
  sample,
  example,
  categoryTo,
  sampleInvestment,
  sampleCategories,
  sampleExpected,
  section = "overview",
  sectionTo,
  sampleGroups,
}: {
  sample?: NonNullable<ProjectDetail>;
  /** FLOW-404. The השקעה data of a sample project; without it a sample project shows no investment. */
  sampleInvestment?: ProjectInvestment;
  example?: ReactNode;
  /** Dev fixtures send a category row here. Production builds the project route. */
  categoryTo?: string;
  /** FLOW-401. A sample project's category groups and month marks (stories). */
  sampleCategories?: { groups: Record<string, string>; months: ProjectCategoryMonthRow[] };
  /** FLOW-403. The "צפוי" months of a sample project (dev routes and Storybook). */
  sampleExpected?: ExpectedMonths;
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
  const [period, setPeriod] = useProjectPeriod();
  const [periodSheet, setPeriodSheet] = useState(false);
  const detail = useProjectQuery(sample ? "" : projectId, period);
  // FLOW-360: the project's group and the company's groups, for the ⋯ menu's קבוצה row.
  const liveGroups = useProjectGroups(projectId, sample == null);
  const groups = sampleGroups ?? liveGroups;
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const blocked = useBlockedPreview();
  // FLOW-804: a page showing a read (its last one, or the one saved on the phone) keeps it when a
  // refresh fails; the server is slow or away, and the figures it has are still the project's.
  const phase = sample || (preview === "off" && detail.data != null) ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
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
  if (phase.kind === "loading") return <ProjectLoading search={search} example={example} />;
  if (phase.kind === "error") {
    return (
      <ScreenState title="פרויקט" backTo={`/projects${search}`} phase={phase} onRetry={() => { void detail.refetch(); }} />
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
  const periodWords = periodPhrase(period, undefined, "project");
  if (section === "expenses") {
    const expenses = absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot);
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <ScreenHeader title="הוצאות" kicker={project.name} subtitle={periodWords} backTo={sectionHref("overview")} />
        {project.budget_agorot != null && period.kind === "all" ? (
          <div className="ui-page-pad ui-project-budget">
            <BudgetBar label="תקציב" spentAgorot={expenses} budgetAgorot={project.budget_agorot} />
          </div>
        ) : null}
        <ProjectCategories
          project={project}
          search={search}
          categorySearch={periodQuery}
          categoryTo={categoryTo == null ? undefined : `${categoryTo}${search}`}
          period={sample ? undefined : period}
          sampleGroups={sampleCategories?.groups}
          sampleMonths={sampleCategories?.months}
        />
        {/* FLOW-403: expected months under the categories (plan option A3). */}
        <ProjectExpectedMonths projectId={project.id} live={sample == null} sample={sampleExpected} />
      </div>
    );
  }
  if (section === "investment") {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <ScreenHeader title="השקעה" kicker={project.name} backTo={sectionHref("overview")} />
        <ProjectInvestmentSection project={project} sample={sampleInvestment} />
      </div>
    );
  }
  if (section === "transactions") {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <ScreenHeader
          title="תנועות"
          kicker={project.name}
          subtitle={periodWords}
          backTo={sectionHref("overview")}
          below={
            // FLOW-402: every line of the project, in Search with the project chip set.
            <TextLink to={`/search${withParams(search, { project: project.id })}`} tone="quiet">כל התנועות</TextLink>
          }
        />
        <ProjectTransactions transactions={project.transactions} search={search} live={sample == null} />
      </div>
    );
  }
  if (section === "loans") {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <ScreenHeader title="הלוואות" kicker={project.name} backTo={sectionHref("overview")} />
        <List>
          {(project.loans ?? []).map((loan) => (
            <ListRow
              key={loan.id}
              variant="item"
              title={loan.name}
              hint={loan.balance_minor <= 0n ? "נפרעה" : undefined}
              meta={<bdi className="ui-num ui-project-row-figure" dir="ltr">{formatAmountText(loan.balance_minor, loan.currency)}</bdi>}
              href={`/settings/loans/${loan.id}${search}`}
              chevron
            />
          ))}
        </List>
      </div>
    );
  }
  const currencyRows = projectRows(project, companyCurrency);
  const singleCurrency = currencyRows.length === 1;
  const profitRows = currencyRows.map((row) => ({
    row,
    profit: projectRowProfit(project, row, overheadOn, singleCurrency),
  }));
  const marginShown = singleCurrency
    ? (() => {
      const row = currencyRows[0];
      if (row == null || row.income_minor <= 0n) return null;
      const profit = profitRows[0]?.profit ?? 0n;
      const margin = Number((profit * 100n) / row.income_minor);
      return margin < 0 ? `−${String(Math.abs(margin))}%` : `${String(margin)}%`;
    })()
    : null;
  // A loss is named in the label: red on the violet band does not read (DESIGN-RULES 3.5).
  // FLOW-339: with a profit in one currency and a loss in another, the label names both.
  const bandSign = profitSign(profitRows.map(({ profit }) => profit));
  const bandWord = bandSign === "mixed" ? "רווח והפסד" : bandSign === "loss" ? "הפסד" : "רווח";
  const stateLine = projectStateLine(project);
  const loans = openLoans(project);
  const onlyLoan = loans.length === 1 ? loans[0] : undefined;
  const projectSearch = withParams(periodQuery, { project: project.id });
  const investmentData = sampleInvestment ?? toProjectInvestment(project);
  const investmentShown = investmentFigure(investmentData) != null;
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
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        // A new period shows the last figures until its read lands; the spinner says they are not its yet.
        status={!sample && detail.isPlaceholderData ? (
          <div className="ui-ptr">
            <span className="ui-spinner" role="status" aria-label="מרענן" />
          </div>
        ) : null}
        trailing={holdWrites ? <ReservedMenuSlot /> : (
          <ProjectMenu
            projectId={project.id}
            name={project.name}
            budget={project.budget_agorot ?? null}
            finished={project.status === "finished"}
            groups={groups}
            sample={sample != null}
            overhead={overhead}
            // FLOW-340 C: with no investment data the overview hides its row, so the menu keeps the way in.
            investmentTo={investmentShown || investmentData.isOverhead ? undefined : sectionHref("investment")}
          />
        )}
      >
        <BandHero className="ui-band-hero-project">
          <FocusTitle className="t-band-title">{project.name}</FocusTitle>
          {/* FLOW-335: an active project says nothing here; only another state takes the line. */}
          {stateLine == null ? null : <p className="t-label">{stateLine}</p>}
          {/* FLOW-336: a sideways swipe on the figure steps the period (decision 0150).
              FLOW-359 (A): Home's one period pill replaces the presets and the stepper. */}
          <PeriodSwipe period={period} onChange={setPeriod}>
            <p className="ui-band-label t-label ui-project-period-label">
              {pillNamesPeriod(period) ? bandWord : `${bandWord} ${periodWords}`}
              {marginShown == null ? null : (
                <>
                  {" · רווחיות "}
                  <bdi dir="ltr">{marginShown}</bdi>
                </>
              )}
            </p>
            <div className="ui-hero-pill">
              <PeriodPicker
                pill={windowLabel(period, undefined, "project")}
                name={`${windowLabel(period, undefined, "project")} – בחירת תקופה`}
                open={periodSheet}
                onOpenChange={setPeriodSheet}
                period={period}
                onChange={setPeriod}
                scope="project"
              />
            </div>
            {/* FLOW-340 C: the band holds the profit only; income and expenses are the first rows below. */}
            <div className="t-display ui-project-profits">
              {profitRows.map(({ row, profit: rowProfit }) => (
                <p key={row.currency}>
                  <BigNumber agorot={rowProfit} currency={row.currency} loss={rowProfit < 0n} />
                </p>
              ))}
            </div>
          </PeriodSwipe>
        </BandHero>
      </TopBand>
      <ProjectOverviewRows
        project={project}
        investmentData={investmentData}
        currencyRows={currencyRows}
        links={{
          income: `/search${withParams(projectSearch, { dir: "income" })}`,
          expenses: sectionHref("expenses"),
          investment: sectionHref("investment"),
          // One loan opens its own page (#305); several open the project's list.
          loans: onlyLoan == null ? sectionHref("loans") : `/settings/loans/${onlyLoan.id}${search}`,
          transactions: sectionHref("transactions"),
          months: `/projects/${project.id}/months${periodQuery}`,
        }}
      />
    </div>
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
          <p className="t-display"><BigNumber agorot={0n} /></p>
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

function ProjectMenu({
  projectId,
  name,
  budget,
  finished,
  groups,
  sample = false,
  overhead,
  investmentTo,
}: {
  projectId: string;
  name: string;
  budget: bigint | null;
  finished: boolean;
  /** FLOW-360 A: the קבוצה row shows once the groups are read. */
  groups?: ProjectGroups;
  sample?: boolean;
  /** FLOW-340 C: the overhead switch left the page body for this menu. */
  overhead?: ReactNode;
  /** FLOW-340 C: set when the overview hides its השקעה row, so the data can still be added. */
  investmentTo?: string;
}) {
  const blocked = useBlockedPreview();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [groupView, setGroupView] = useState<"pick" | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const action = finished ? "החזרה לפעיל" : "סיום הפרויקט";
  const save = useWrite({
    failure: "לא הצלחנו לעדכן את הפרויקט.",
    success: finished ? "הפרויקט חזר לפעיל" : "הפרויקט סומן כהסתיים",
    keys: ["dashboard", "project"],
    onSuccess: () => { setConfirm(false); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("upsert_project", {
        p_id: projectId,
        p_name: name,
        ...(budget == null ? {} : { p_budget_agorot: Number(budget) }),
        p_status: finished ? "active" : "finished",
      }));
    },
  });
  return (
    <>
      <IconButton
        ref={opener}
        label="עוד"
        onBand
        onClick={() => {
          setMenu(true);
        }}
      >
        <MoreIcon />
      </IconButton>
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        {overhead}
        {/* FLOW-334: the menu's actions are rows, so "סיום הפרויקט" is not a second kind of control. */}
        <List className="ui-project-menu-list">
          {investmentTo == null ? null : (
            <ListRow variant="item" title="נתוני השקעה" href={investmentTo} chevron />
          )}
          {groups == null ? null : (
            <ListRow
              variant="button"
              title="קבוצה"
              meta={groups.groups.find((group) => group.id === groups.currentId)?.name ?? NO_GROUP}
              chevron
              onClick={() => {
                setMenu(false);
                setGroupView("pick");
              }}
            />
          )}
          <ListRow
            variant="button"
            title={action}
            onClick={() => {
              setMenu(false);
              setConfirm(true);
            }}
          />
        </List>
      </Sheet>
      {groups == null ? null : (
        <ProjectGroupSheets
          projectId={projectId}
          groups={groups.groups}
          currentId={groups.currentId}
          view={groupView}
          onView={setGroupView}
          onBack={() => {
            setGroupView(null);
            setMenu(true);
          }}
          blocked={blocked}
          returnFocusRef={opener}
          sample={sample}
        />
      )}
      {/* Either way can be undone, so the confirm is neutral: no red and no bin (FLOW-341 rule). */}
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={finished ? "להחזיר את הפרויקט לפעיל?" : "לסיים את הפרויקט?"}
        item={name}
        consequence="פרויקט לא נמחק. אפשר להחזיר אותו אחר כך."
        confirmLabel={action}
        returnFocusRef={opener}
        busy={save.isPending}
        onConfirm={() => {
          if (blocked()) return;
          save.mutate();
        }}
      />
    </>
  );
}
