import { useCompanyCurrency } from "../company-currency";
import { formatAmountText, formatIls, wholeShekels, type CashMonths, type Dashboard, type ProjectRow } from "@flow/shared";
import {
  companyRows,
  dashboardHasBooks,
  heroLabelProfit,
  primaryCurrency,
  profitInCurrency,
  profitSign,
  projectAmountFigures,
  roundedHeroProfit,
} from "../by-currency";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useHeldOrder } from "../list-hold";
import { useNavigate } from "react-router-dom";
import { unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "../unpaid";
import { useAuth } from "../auth";
import { cashMonthKey, cashSummaryRows, cashTitle, earlierMonthRows, shownCashRows } from "../cash";
import { useCashMonthsQuery, useOpenCashRow } from "../use-cash";
import { BackButton } from "../ui/back";
import { CashRows } from "../ui/cash-rows";
import { BannerRows, type BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { ChangePill } from "../ui/change-pill";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { FlowLines, Hero } from "../ui/hero";
import { CalendarIcon, ChartIcon, DocumentIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodPicker } from "../ui/period-picker";
import { PeriodSwipe } from "../ui/period-swipe";
import { ProfitMark } from "../ui/profit-mark";
import { SearchEntry } from "../ui/search-entry";
import { CashHomeSkeleton, HomeSkeleton } from "./home-skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { emptyHomeLabel } from "../home-label";
import { breakdownPath } from "../breakdown";
import { comparisonWords, heroProfitLabel, periodPhrase, windowLabel, type PeriodChoice } from "../period";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldWrites } from "../use-is-viewer";
import { useBooks, useDashboardQuery, useUnpaidQuery } from "../use-books";
import { SetupHomeSlot } from "../setup/home";
import { missingBillsTitle, useMissingBillsQuery } from "../forecast";

function changePercent(current: bigint, previous: bigint | null): number | null {
  if (previous == null || previous === 0n) return null;
  const currentShekels = wholeShekels(current);
  const previousShekels = wholeShekels(previous);
  if (previousShekels === 0) return null;
  return ((currentShekels - previousShekels) / Math.abs(previousShekels)) * 100;
}

/** Marks the page while a band shows (the status bar follows it), and while a failure hides it. */
function useBandMark(failed: boolean, showBooks: boolean) {
  useEffect(() => {
    if (!failed && showBooks) {
      document.documentElement.dataset.band = "on";
      return () => {
        delete document.documentElement.dataset.band;
      };
    }
    if (!failed) return;
    document.documentElement.dataset.band = "off";
    return () => {
      delete document.documentElement.dataset.band;
    };
  }, [failed, showBooks]);
}

/** Before a bank or SUMIT is connected there are no books: the band names it and the action connects one. */
function NoBooksYet({ previewing, example, search }: { previewing: boolean; example?: ReactNode; search: string }) {
  const holdWrites = useHoldWrites();
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand preview={previewing} example={example} wordmark={false}>
        <Hero label={emptyHomeLabel} />
      </TopBand>
      <EmptyState
        icon={<ChartIcon />}
        title="עוד אין נתונים"
        body="הרווח יופיע כאן אחרי חיבור בנק או SUMIT."
        action={holdWrites ? undefined : (
          // FLOW-328: a bank or SUMIT both start the books, so the action opens the connections page.
          <Button variant="pill" to={`/settings/connections${search}`}>
            חיבור בנק או SUMIT
          </Button>
        )}
      />
      <SetupHomeSlot emptyHome />
    </div>
  );
}

/**
 * Home: the month's cash (FLOW-413, the owner's "Cash first", frame b). The profit view is one tap
 * away on "רווח החודש". Home still reads the dashboard: its review count fills the attention box,
 * and it says whether the books have started.
 */
export function HomeScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status } = useAuth();
  const previewing = preview !== "off";
  const cash = useCashMonthsQuery();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();
  // FLOW-403: late recurring bills, a count on the attention box. A failed read just hides the row.
  const missing = useMissingBillsQuery();

  const cashPhase = screenPhase(preview, cash);
  const dashboardPhase = screenPhase(preview, dashboard);
  const errorPhase = cashPhase.kind === "error" ? cashPhase : dashboardPhase.kind === "error" ? dashboardPhase : null;
  const ready = cashPhase.kind === "ready" && dashboardPhase.kind === "ready";
  const showBooks = ready && cash.data != null && dashboard.data != null && hasBooks(dashboard.data);
  const loading = errorPhase == null && (cashPhase.kind === "loading" || dashboardPhase.kind === "loading" || (!previewing && status === "loading" && !showBooks));
  const failed = errorPhase != null || previewHidesBand(preview);
  const offline = errorPhase != null ? errorPhase.offline : preview === "error";
  useBandMark(failed, showBooks);

  function retry() {
    if (previewing) {
      void navigate("/?preview=1");
      return;
    }
    void cash.refetch();
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <CashHomeSkeleton preview={previewing} example={example} />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks || cash.data == null) {
    return <NoBooksYet previewing={previewing} example={example} search={search} />;
  }

  const unpaidPhase = screenPhase(preview, unpaid);
  return (
    <CashHome
      data={cash.data}
      previewing={previewing}
      search={search}
      attention={attentionRows({
        pending: dashboard.data.review_count,
        unpaidCount: unpaidPhase.kind === "ready" ? unpaidOpenRows(unpaid.data ?? []).length : 0,
        unpaidGross: unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? []) : 0n,
        unpaidOther: unpaidPhase.kind === "ready" ? unpaidTotals(unpaid.data ?? []).filter((total) => total.currency !== "ILS") : [],
        missingCount: missing.data?.length ?? 0,
        search,
      })}
      unpaidFailed={unpaidPhase.kind === "error"}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      checklist={<SetupHomeSlot emptyHome={false} />}
    />
  );
}

/**
 * Frame b: the band names the month and shows its cash, then נכנס, יצא and a quiet רווח החודש.
 * The attention box (review, open invoices, late bills) follows when it has rows, then the
 * earlier months, each opening its own page.
 */
export function CashHome({
  data,
  previewing,
  search,
  attention,
  unpaidFailed = false,
  onUnpaidRetry,
  example,
  checklist,
  now,
}: {
  data: NonNullable<CashMonths>;
  previewing: boolean;
  search: string;
  attention: BannerRow[];
  unpaidFailed?: boolean;
  onUnpaidRetry?: () => void;
  /** Storybook sample label. The live home never passes it. */
  example?: ReactNode;
  checklist?: ReactNode;
  /** Stories and tests pin the month names. */
  now?: Date;
}) {
  const open = useOpenCashRow();
  const month = data.months[0];
  const key = month == null ? null : cashMonthKey(month.month);
  const rows = shownCashRows(month, data.base_currency);
  const earlier = earlierMonthRows(data, search, now);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand wordmark={false} preview={previewing} example={example} trailing={<SearchEntry to={`/search${search}`} onBand />}>
        <Hero
          label={key == null ? "תזרים" : cashTitle(key, now)}
          figures={rows.map((row) => ({ agorot: row.net_minor, currency: row.currency, loss: row.net_minor < 0n }))}
        />
      </TopBand>
      {key == null ? null : <CashRows rows={cashSummaryRows(key, rows, search, now)} onOpen={open} />}

      {checklist}

      {unpaidFailed ? (
        <div className="ui-page-pad">
          <ErrorState
            offline={false}
            onRetry={() => {
              onUnpaidRetry?.();
            }}
          />
        </div>
      ) : null}
      {/* Design lead: Home shows money that needs a hand whatever its main figure; an empty box hides. */}
      <BannerRows rows={attention} />

      {earlier.length > 0 ? (
        <>
          <SectionHead title="חודשים קודמים" />
          <CashRows rows={earlier} months />
        </>
      ) : null}
    </div>
  );
}

/**
 * The profit view (frame b-2), one tap from Home's "רווח החודש": the profit for a period, with
 * הכנסות and הוצאות, the projects and the attention box, as Home showed it before FLOW-413.
 */
export function ProfitScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status } = useAuth();
  const previewing = preview !== "off";
  const books = useBooks();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();
  // FLOW-403: late recurring bills, a count on the pending card. A failed read just hides the row.
  const missing = useMissingBillsQuery();
  const companyCurrency = useCompanyCurrency();

  const phase = screenPhase(preview, dashboard);
  const showBooks = phase.kind === "ready" && dashboard.data != null && hasBooks(dashboard.data);
  const loading = phase.kind === "loading" || (!previewing && status === "loading" && !showBooks);
  const failed = phase.kind === "error" || previewHidesBand(preview);
  const offline = phase.kind === "error" ? phase.offline : preview === "error";

  useBandMark(failed, showBooks);

  function retry() {
    if (previewing) {
      void navigate("/profit?preview=1");
      return;
    }
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <HomeSkeleton preview={previewing} example={example} period={books.period} onPeriod={books.setPeriod} />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks) return <NoBooksYet previewing={previewing} example={example} search={search} />;

  const unpaidPhase = screenPhase(preview, unpaid);
  return (
    <HomeBooks
      companyCurrency={companyCurrency}
      data={dashboard.data}
      previewing={previewing}
      search={search}
      unpaidGross={unpaidPhase.kind === "ready" ? unpaidOpenGross(unpaid.data ?? []) : 0n}
      unpaidCount={unpaidPhase.kind === "ready" ? unpaidOpenRows(unpaid.data ?? []).length : 0}
      unpaidOther={unpaidPhase.kind === "ready" ? unpaidTotals(unpaid.data ?? []).filter((total) => total.currency !== "ILS") : []}
      unpaidPhase={unpaidPhase.kind}
      missingCount={missing.data?.length ?? 0}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      period={books.period}
      onPeriod={books.setPeriod}
      refreshing={dashboard.isPlaceholderData}
      back={<BackButton fallback={`/${search}`} onBand text="תזרים" label="חזרה לתזרים" />}
    />
  );
}

function hasBooks(data: Dashboard): boolean {
  return dashboardHasBooks(data);
}

export function HomeBooks({
  data,
  previewing,
  search,
  unpaidGross,
  unpaidCount,
  unpaidOther = [],
  unpaidPhase = "ready",
  missingCount = 0,
  missingTo,
  onUnpaidRetry,
  period,
  onPeriod,
  example,
  refreshing = false,
  notice,
  checklist,
  back,
  companyCurrency = "ILS",
}: {
  /** The company's currency, for an empty period's zeros (a USD company reads $0, not ₪0). */
  companyCurrency?: string;
  data: Dashboard;
  previewing: boolean;
  search: string;
  unpaidGross: bigint;
  unpaidCount: number;
  /** FLOW-330. Open unpaid totals in other currencies, after the ILS one. */
  unpaidOther?: { currency: string; minor: bigint }[];
  unpaidPhase?: "loading" | "error" | "empty" | "ready";
  /** FLOW-403. Recurring bills that are late this month; the row shows only above 0. */
  missingCount?: number;
  /** Dev fixtures send the late-bills row here. Production opens `/missing-bills`. */
  missingTo?: string;
  onUnpaidRetry?: () => void;
  period: PeriodChoice;
  onPeriod: (choice: PeriodChoice) => void;
  /** Storybook sample label. The live home never passes it. */
  example?: ReactNode;
  /** ld-07. The spinner sits above the band content. */
  refreshing?: boolean;
  /** ld-09. A note under the band, above the pending card. */
  notice?: ReactNode;
  checklist?: ReactNode;
  /** FLOW-413 (frame b-2): the profit view's way back to Home's cash, on the band's start. */
  back?: ReactNode;
}) {
  const rankCurrency = primaryCurrency(data);
  const ranked = homeProjects(data.projects, rankCurrency);
  const leading = useHeldOrder(ranked, (project) => project.id);
  const currencyRows = companyRows(data, data.base_currency ?? companyCurrency);
  const heroFigures = currencyRows.map((row) => ({
    agorot: roundedHeroProfit(row.income_minor, row.expense_minor),
    currency: row.currency,
    loss: roundedHeroProfit(row.income_minor, row.expense_minor) < 0n,
  }));
  const hero = heroLabelProfit(heroFigures);
  // One currency on Home: its change against the previous period (0147). Older payloads have it in ILS only.
  const single = currencyRows.length === 1 ? currencyRows[0] : undefined;
  const previous = single == null
    ? null
    : single.prev_income_minor != null && single.prev_expense_minor != null
      ? roundedHeroProfit(single.prev_income_minor, single.prev_expense_minor)
      : single.prev_net_profit_minor !== undefined
        ? single.prev_net_profit_minor
        : single.currency !== "ILS"
          ? null
          : data.prev_income_agorot != null && data.prev_expense_agorot != null
            ? roundedHeroProfit(data.prev_income_agorot, data.prev_expense_agorot)
            : data.prev_net_agorot;
  const percent = single ? changePercent(heroFigures[0]?.agorot ?? 0n, previous) : null;
  const [periodSheet, setPeriodSheet] = useState(false);
  const comparison = comparisonWords(period);
  const phrase = periodPhrase(period);
  const attention = attentionRows({
    pending: data.review_count,
    unpaidCount: unpaidPhase === "ready" ? unpaidCount : 0,
    unpaidGross,
    unpaidOther,
    missingCount,
    missingTo,
    search,
  });

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <TopBand
        wordmark={false}
        preview={previewing}
        example={example}
        status={refreshing ? (
          <div className="ui-ptr">
            <span className="ui-spinner" role="status" aria-label="מרענן" />
          </div>
        ) : null}
        leading={back}
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        {/* FLOW-336: a sideways swipe on the figure steps the period (decision 0150). */}
        <PeriodSwipe period={period} onChange={onPeriod}>
          <Hero
            label={heroProfitLabel(period, profitSign(heroFigures.map((figure) => figure.agorot)) === "mixed" ? "mixed" : hero)}
            figures={heroFigures}
            pill={
              // FLOW-355 (A): one period pill instead of the tabs and stepper, so a project row fits on a 667px screen.
              <PeriodPicker pill={windowLabel(period)} name={`${windowLabel(period)} – בחירת תקופה`} open={periodSheet} onOpenChange={setPeriodSheet} period={period} onChange={onPeriod} />
            }
          />
        </PeriodSwipe>
      </TopBand>

      {notice}

      <FlowLines
        lines={currencyRows.map((row) => ({
          currency: row.currency,
          income: row.income_minor,
          expense: row.expense_minor,
        }))}
        links={{
          income: breakdownPath("income", search),
          expense: breakdownPath("expense", search),
          period: phrase,
        }}
      />
      {comparison && percent != null ? (
        <p className="ui-flow-note">
          <ChangePill percent={percent} comparison={comparison} />
        </p>
      ) : null}

      {checklist}

      <SectionHead title="פרויקטים" />
      {leading.length === 0 ? (
        <p className="ui-page-pad t-hint">אין תנועות בפרויקטים בתקופה הזו.</p>
      ) : (
        <ProjectLines projects={leading.slice(0, HOME_PROJECTS_BEFORE_ATTENTION)} search={search} rankCurrency={rankCurrency} />
      )}

      {/* FLOW-355 (A): the review and invoices rows sit under the first projects, so a project shows on the first screen. */}
      {unpaidPhase === "error" ? (
        <div className="ui-page-pad">
          <ErrorState
            offline={false}
            onRetry={() => {
              onUnpaidRetry?.();
            }}
          />
        </div>
      ) : null}

      <BannerRows rows={attention} />

      {leading.length > HOME_PROJECTS_BEFORE_ATTENTION ? (
        <ProjectLines projects={leading.slice(HOME_PROJECTS_BEFORE_ATTENTION)} search={search} rankCurrency={rankCurrency} />
      ) : null}
      <p className="ui-page-pad">
        <TextLink to={`/projects${search}`} tone="quiet">
          לכל הפרויקטים
        </TextLink>
      </p>
    </div>
  );
}

/** FLOW-355: the review and invoices rows come after this many projects. */
const HOME_PROJECTS_BEFORE_ATTENTION = 2;

function ProjectLines({ projects, search, rankCurrency }: { projects: readonly ProjectRow[]; search: string; rankCurrency: string }) {
  return (
    <ul className="ui-project-list">
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectLine project={project} search={search} rankCurrency={rankCurrency} />
        </li>
      ))}
    </ul>
  );
}

/** Home lists at most this many projects (profit by period, plan §2). */
export const HOME_PROJECTS = 5;

function hasLines(project: ProjectRow): boolean {
  if (project.income_agorot !== 0n || project.direct_agorot !== 0n || project.shared_agorot !== 0n) return true;
  return project.by_currency.some((row) => row.income_minor !== 0n || row.direct_minor !== 0n || row.shared_minor !== 0n);
}

/**
 * The projects Home shows for its period: only those with lines in it, losses first (the
 * biggest loss on top), then the most profitable, up to HOME_PROJECTS.
 */
export function homeProjects(projects: readonly ProjectRow[], currency: string): ProjectRow[] {
  return projects
    .filter(hasLines)
    .map((project) => ({ project, profit: profitInCurrency(project, currency) }))
    .sort((a, b) => {
      const lossA = a.profit < 0n;
      const lossB = b.profit < 0n;
      if (lossA !== lossB) return lossA ? -1 : 1;
      if (lossA) return a.profit < b.profit ? -1 : a.profit > b.profit ? 1 : 0;
      return a.profit < b.profit ? 1 : a.profit > b.profit ? -1 : 0;
    })
    .slice(0, HOME_PROJECTS)
    .map((entry) => entry.project);
}

/**
 * FLOW-321. The Home pending card: one row to Review and one to Unpaid with its
 * total, each only when it has something. A count of 1 reads singular. FLOW-403 adds a
 * third row, the late recurring bills, as a count only.
 */
export function attentionRows({
  pending,
  unpaidCount,
  unpaidGross,
  unpaidOther = [],
  missingCount = 0,
  missingTo = "/missing-bills",
  search,
}: {
  pending: number;
  unpaidCount: number;
  unpaidGross: bigint;
  unpaidOther?: { currency: string; minor: bigint }[];
  missingCount?: number;
  missingTo?: string;
  search: string;
}): BannerRow[] {
  const rows: BannerRow[] = [];
  if (pending > 0) {
    rows.push({
      id: "review",
      to: `/review${search}`,
      title: pending === 1 ? "פריט אחד ממתין לאישור" : <><bdi dir="ltr">{String(pending)}</bdi> פריטים ממתינים לאישור</>,
    });
  }
  if (unpaidCount > 0) {
    rows.push({
      id: "unpaid",
      to: `/unpaid${search}`,
      icon: <DocumentIcon size={24} stroke={1.9} />,
      title: unpaidCount === 1 ? "חשבונית פתוחה אחת" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות פתוחות</>,
      hint: unpaidOther.length === 0 ? (
        <><bdi dir="ltr">{formatIls(unpaidGross)}</bdi> · לגבייה</>
      ) : (
        <>
          {[
            ...(unpaidGross !== 0n ? [formatIls(unpaidGross)] : []),
            ...unpaidOther.map((total) => formatAmountText(total.minor, total.currency)),
          ].map((text) => (
            <span key={text}><bdi dir="ltr">{text}</bdi> · </span>
          ))}
          לגבייה
        </>
      ),
    });
  }
  // FLOW-403 (plan option A1): a count, no hint and no total, only when a bill is late.
  if (missingCount > 0) {
    rows.push({
      id: "missing",
      to: `${missingTo}${search}`,
      icon: <CalendarIcon size={24} stroke={1.9} />,
      title: missingCount === 1 ? missingBillsTitle(1) : <><bdi dir="ltr">{String(missingCount)}</bdi> חשבונות לא הגיעו</>,
    });
  }
  return rows;
}

function ProjectLine({ project, search, rankCurrency }: { project: ProjectRow; search: string; rankCurrency: string }) {
  const amounts = projectAmountFigures(project);
  const single = amounts.length === 1 ? amounts[0] : undefined;
  // The mark follows the main currency; other currencies show their own figure under it (0096).
  const marked = amounts.find((amount) => amount.currency === rankCurrency) ?? amounts[0];
  const loss = (marked?.minor ?? project.profit_agorot) < 0n;
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={<ProfitMark loss={loss} />}
      agorot={single?.minor ?? project.profit_agorot}
      currency={single?.currency}
      amounts={amounts.length > 1 ? amounts : undefined}
      loss={(single?.minor ?? project.profit_agorot) < 0n}
      href={`/projects/${project.id}${search}`}
    />
  );
}
