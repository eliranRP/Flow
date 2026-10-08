import { formatAmountText, type ProfitMonths, type ProjectDetail } from "@flow/shared";
import { useCompanyCurrency } from "../company-currency";
import { projectExpenseMinor, projectRows, type ProjectCurrencyRow } from "../by-currency";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ProjectLoanList } from "./loan-match";
import { loanRowProps, useLoanMarks } from "./loan-marks";
import { absAgorot } from "../agorot";
import { overheadHint, shownProfit } from "../overhead";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { allTime, periodPhrase } from "../period";
import { useProjectPeriod, withPeriodSearch } from "../project-period";
import { PeriodBar } from "../ui/period-bar";
import { PeriodSwipe } from "../ui/period-swipe";
import { profitMonthsSummary } from "./profit-months";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { withSheetBackground } from "../sheet-background";
import { useProjectQuery, useProfitMonthsQuery } from "../use-books";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { assertNoError, useWrite } from "../use-write";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { BackButton } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { CalendarIcon, CameraIcon, DocumentIcon, MoreIcon } from "../ui/icons";
import { BandFigures, BandHero, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { FocusTitle } from "../ui/focus-title";
import { BudgetBar } from "../ui/progress-bar";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { TextLink } from "../ui/text-link";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { KEPT_OUT_SHORT, ReservedMenuSlot, useBlockedPreview } from "./screen-shared";
import { categoryHref } from "./project-category-screen";
import { ProjectInvestmentSection, type ProjectInvestment } from "./project-investment";

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
            <span className="ui-skel-project-period">
              <Skeleton tone="band" className="ui-skel-project-period-bar" />
            </span>
            <Skeleton tone="band" className="ui-skel-project-label" />
            <Skeleton tone="band" className="ui-skel-project-num" />
            <span className="ui-band-figures">
              <Skeleton tone="band" className="ui-skel-project-figure" />
              <Skeleton tone="band" className="ui-skel-project-figure" />
            </span>
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

function pendingApprovalTitle(count: number): string {
  return count === 1 ? "1 ממתינה לאישור" : `${String(count)} ממתינות לאישור`;
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

function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, value);
  return `?${params.toString()}`;
}

/** Confirmed categories, then the amount still waiting, so the lines match the project's expenses. */
function ProjectCategories({
  project,
  search,
  categorySearch = search,
  categoryTo,
}: {
  project: NonNullable<ProjectDetail>;
  search: string;
  /** The category list opens on the project's period. */
  categorySearch?: string;
  categoryTo?: string;
}) {
  const pendingOther = project.pending_other_currencies ?? [];
  // pending_count counts every waiting line; the non-ILS ones get their own rows below.
  const pendingOtherCount = pendingOther.reduce((sum, bucket) => sum + bucket.count, 0);
  const pending = Math.max(0, (project.pending_count ?? 0) - pendingOtherCount);
  const waiting = pending > 0;
  const categoryRows = project.categories_by_currency ?? project.categories.map((category) => ({
    currency: "ILS" as const,
    id: category.id,
    name: category.name,
    amount_minor: category.amount_agorot,
    has_shared_share: category.has_shared_share,
  }));
  const grouped = new Map<string, typeof categoryRows>();
  for (const row of categoryRows) {
    const list = grouped.get(row.currency) ?? [];
    list.push(row);
    grouped.set(row.currency, list);
  }
  const currencies = [...grouped.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "ILS") return -1;
    if (b === "ILS") return 1;
    return a.localeCompare(b);
  });
  const hasCategories = currencies.some((currency) => (grouped.get(currency)?.length ?? 0) > 0);
  if (!hasCategories && !waiting && pendingOther.length === 0) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }
  // The section is titled הוצאות, so the figures carry no minus (FLOW-328).
  return (
    <>
      <List>
      {currencies.flatMap((currency) => (grouped.get(currency) ?? []).map((category) => (
        <ListRow
          key={`${currency}:${category.id ?? category.name ?? ""}`}
          variant="project"
          title={category.name ?? "בלי קטגוריה"}
          agorot={absAgorot(category.amount_minor)}
          currency={currency}
          loss={false}
          chevron={category.id != null}
          href={category.id != null ? (categoryTo ?? categoryHref(project.id, category.id, currency, categorySearch)) : undefined}
          wrapHint={category.has_shared_share === true}
          hint={category.has_shared_share === true ? (
            <span className="ui-shared-note t-hint">כולל חלק מהוצאות משותפות</span>
          ) : undefined}
        />
      )))}
      {waiting ? (
        <ListRow
          variant="project"
          title={pendingApprovalTitle(pending)}
          agorot={absAgorot(project.pending_agorot ?? 0n)}
          currency="ILS"
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ) : null}
      {pendingOther.map((bucket) => (
        <ListRow
          key={bucket.currency}
          variant="project"
          title={pendingApprovalTitle(bucket.count)}
          agorot={absAgorot(bucket.expense_minor)}
          currency={bucket.currency}
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ))}
    </List>
    </>
  );
}

export function ProjectDetailScreen({
  sample,
  sampleMonths,
  example,
  categoryTo,
  sampleInvestment,
}: {
  sample?: NonNullable<ProjectDetail>;
  /** FLOW-404. The השקעה card of a sample project; without it a sample project shows no card. */
  sampleInvestment?: ProjectInvestment;
  /** The "לפי חודש" row's counts for a sample project (dev routes and Storybook). */
  sampleMonths?: ProfitMonths;
  example?: ReactNode;
  /** Dev fixtures send a category row here. Production builds the project route. */
  categoryTo?: string;
} = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  // The project's own period (decision 0141): it starts as Home's, and changing it leaves Home alone.
  const [period, setPeriod] = useProjectPeriod();
  const detail = useProjectQuery(sample ? "" : projectId, period);
  // FLOW-337: the "לפי חודש" row counts the whole project, as its page lists it.
  const months = useProfitMonthsQuery(sample ? "" : projectId, allTime());
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const blocked = useBlockedPreview();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const location = useLocation();
  const [overheadOn, setOverheadOn] = useState(sample?.after_overhead === true);
  const wantedOverhead = useRef(false);
  const heldTransactions = useHeldOrder((sample ?? detail.data)?.transactions ?? [], (txn) => txn.id);
  const heldIds = heldTransactions.map((txn) => txn.id);
  const listFrom = `${location.pathname}${location.search}`;
  const projectMarks = useLoanMarks(heldTransactions.map((txn) => txn.id), sample == null);
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
  const expenses = absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot);
  // A loss is named in the label: red on the violet band does not read (DESIGN-RULES 3.5).
  const bandLoss = singleCurrency && (profitRows[0]?.profit ?? 0n) < 0n;
  const periodWords = periodPhrase(period, undefined, "project");
  const stateLine = projectStateLine(project);
  const periodQuery = withPeriodSearch(search, period);
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
        trailing={holdWrites ? <ReservedMenuSlot /> : <ProjectMenu projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />}
      >
        <BandHero className="ui-band-hero-project">
          <FocusTitle className="t-band-title">{project.name}</FocusTitle>
          {/* FLOW-335: an active project says nothing here; only another state takes the line. */}
          {stateLine == null ? null : <p className="t-label">{stateLine}</p>}
          <PeriodBar period={period} onChange={setPeriod} scope="project" toDateHint={false} />
          {/* FLOW-336: a sideways swipe on the figure steps the period, as the arrows do (decision 0150). */}
          <PeriodSwipe period={period} onChange={setPeriod}>
            <p className="ui-band-label t-label ui-project-period-label">
              {bandLoss ? "הפסד" : "רווח"} {periodWords}
              {marginShown == null ? null : (
                <>
                  {" · רווחיות "}
                  <bdi dir="ltr">{marginShown}</bdi>
                </>
              )}
            </p>
            <div className="t-display ui-project-profits">
              {profitRows.map(({ row, profit: rowProfit }) => (
                <p key={row.currency}>
                  <BigNumber agorot={rowProfit} currency={row.currency} loss={rowProfit < 0n} />
                </p>
              ))}
            </div>
            {currencyRows.map((row) => (
              <BandFigures
                key={row.currency}
                income={formatAmountText(row.income_minor, row.currency)}
                expense={formatAmountText(projectExpenseMinor(row), row.currency)}
              />
            ))}
          </PeriodSwipe>
        </BandHero>
      </TopBand>
      {/* FLOW-337: "לפי חודש" lists every month of the project, whatever the band's period. */}
      <List className="ui-project-months">
        <ListRow
          variant="item"
          href={`/projects/${project.id}/months${periodQuery}`}
          icon={<CalendarIcon />}
          title="לפי חודש"
          hint={profitMonthsSummary(sampleMonths ?? months.data ?? null, companyCurrency)}
          chevron
        />
      </List>
      {project.budget_agorot != null && period.kind === "all" ? (
        <div className="ui-page-pad ui-project-budget">
          <BudgetBar label="תקציב" spentAgorot={expenses} budgetAgorot={project.budget_agorot} />
        </div>
      ) : null}
      {(project.loans ?? []).length > 0 ? (
        <>
          <SectionHead title="הלוואות" />
          <ProjectLoanList rows={project.loans ?? []} />
        </>
      ) : null}
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ProjectCategories
        project={project}
        search={search}
        categorySearch={periodQuery}
        categoryTo={categoryTo == null ? undefined : `${categoryTo}${search}`}
      />
      {/* FLOW-335: the switch sits under the categories, so the band's first row is in reach sooner. */}
      <div className="ui-page-pad ui-project-overhead">
        <Toggle
          label="אחרי חלק בהוצאות כלליות"
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
      </div>
      {sample == null || sampleInvestment != null ? <ProjectInvestmentSection projectId={project.id} sample={sampleInvestment} /> : null}
      <SectionHead title="תנועות">
        {/* FLOW-402: every line of the project, in the search with the project chip set. */}
        <TextLink to={`/search${withParam(search, "project", project.id)}`} tone="quiet">כל התנועות</TextLink>
      </SectionHead>
      {heldTransactions.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות בתקופה הזו" body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." />
      ) : (
        <MonthList
          rows={heldTransactions}
          keyOf={(txn) => txn.id}
          dateOf={(txn) => txn.doc_date}
          amountOf={projectMonthAmount}
          complete={heldTransactions.length < PROJECT_RECENT_CAP}
          renderRow={(txn) => (
            <ListRow
              variant="transaction"
              title={txn.description}
              {...loanRowProps(projectMarks.get(txn.id), projectLineHint(txn))}
              agorot={txn.amount_net}
              sign={txn.direction === "income" ? "in" : "out"}
              currency={txn.currency ?? "ILS"}
              source="invoice"
              href={`/transactions/${txn.id}${search}`}
              state={txnListState(heldIds, txn.id, listFrom)}
            />
          )}
        />
      )}
    </div>
  );
}

/** The line under the project's name: only a state other than active ("הסתיים"), else nothing. */
export function projectStateLine(project: Pick<NonNullable<ProjectDetail>, "state_label" | "status">): string | null {
  const label = project.state_label ?? (project.status === "finished" ? "הסתיים" : null);
  return label == null || label === "" || label === "פעיל" ? null : label;
}

type ProjectLine = NonNullable<ProjectDetail>["transactions"][number];

/**
 * What a project line adds to its month head. A kept-out line adds nothing (0099). A split line
 * adds this project's share, `parts_minor`, taken as it comes: signed in the line's own terms, a
 * reversal part already minus (decision 0138). Plus is the line's own way, so the share moves
 * money the way the line does; a share the reversals push below zero moves it the other way.
 */
export function projectMonthAmount(txn: ProjectLine): { minor: bigint; currency: string; direction: "income" | "expense" } {
  const direction = txn.direction === "income" ? "income" : "expense";
  const currency = txn.currency ?? "ILS";
  if (txn.kept_out === true) return { minor: 0n, currency, direction };
  if (txn.parts_minor != null) {
    const share = txn.parts_minor;
    if (share >= 0n) return { minor: direction === "income" ? share : -share, currency, direction };
    const other = direction === "income" ? "expense" : "income";
    return { minor: other === "income" ? -share : share, currency, direction: other };
  }
  return { minor: txn.amount_net, currency, direction };
}

/** "מחוץ לרווח · category · date". The marker leads, so a kept-out line reads as one at a glance. */
function projectLineHint(txn: ProjectLine): string {
  return [txn.kept_out === true ? KEPT_OUT_SHORT : null, txn.category, formatDayMonth(txn.doc_date)]
    .filter((part): part is string => part != null && part !== "")
    .join(" · ");
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  const location = useLocation();
  const holdWrites = useHoldWrites();
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
        action={holdWrites ? undefined : (
          <Button variant="pill" to={`/add${search}`} state={withSheetBackground(location)}>
            <CameraIcon />
            צילום חשבונית
          </Button>
        )}
      />
    </div>
  );
}

function ProjectMenu({
  projectId,
  name,
  budget,
  finished,
}: {
  projectId: string;
  name: string;
  budget: bigint | null;
  finished: boolean;
}) {
  const blocked = useBlockedPreview();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
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
        label="עוד"
        onBand
        onClick={() => {
          setMenu(true);
        }}
      >
        <MoreIcon />
      </IconButton>
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        <Button
          variant="secondary"
          onClick={() => {
            setMenu(false);
            setConfirm(true);
          }}
        >
          {finished ? "החזרה לפעיל" : "סיום הפרויקט"}
        </Button>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={finished ? "להחזיר את הפרויקט לפעיל?" : "לסיים את הפרויקט?"}
        item={name}
        consequence="פרויקט לא נמחק. אפשר להחזיר אותו אחר כך."
        confirmLabel="אישור"
        destructive={!finished}
        busy={save.isPending}
        onConfirm={() => {
          if (blocked()) return;
          save.mutate();
        }}
      />
    </>
  );
}

/** get_project returns at most this many recent transactions, so a full page may hide older rows of its last month. */
const PROJECT_RECENT_CAP = 40;
