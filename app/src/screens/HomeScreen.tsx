import { useCompanyCurrency } from "../company-currency";
import { formatAmountText, formatIls, wholeShekels, type Dashboard, type ProjectRow } from "@flow/shared";
import {
  companyRows,
  dashboardHasBooks,
  heroLabelProfit,
  primaryCurrency,
  profitInCurrency,
  projectAmountFigures,
  roundedHeroProfit,
} from "../by-currency";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useHeldOrder } from "../list-hold";
import { useNavigate } from "react-router-dom";
import { unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "../unpaid";
import { useAuth } from "../auth";
import { BannerRows, type BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { ChangePill } from "../ui/change-pill";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { FlowLines, Hero } from "../ui/hero";
import { ChartIcon, DocumentIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodBar } from "../ui/period-bar";
import { PeriodSwipe } from "../ui/period-swipe";
import { ProfitMark } from "../ui/profit-mark";
import { SearchEntry } from "../ui/search-entry";
import { HomeSkeleton } from "./home-skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { emptyHomeLabel } from "../home-label";
import { breakdownPath } from "../breakdown";
import { comparisonWords, heroExplanation, heroProfitLabel, periodPhrase, type PeriodChoice } from "../period";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useHoldWrites } from "../use-is-viewer";
import { useBooks, useDashboardQuery, useUnpaidQuery } from "../use-books";
import { SetupHomeSlot } from "../setup/home";

function changePercent(current: bigint, previous: bigint | null): number | null {
  if (previous == null || previous === 0n) return null;
  const currentShekels = wholeShekels(current);
  const previousShekels = wholeShekels(previous);
  if (previousShekels === 0) return null;
  return ((currentShekels - previousShekels) / Math.abs(previousShekels)) * 100;
}

export function HomeScreen({ example }: { example?: ReactNode } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status } = useAuth();
  const holdWrites = useHoldWrites();
  const previewing = preview !== "off";
  const books = useBooks();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();
  const companyCurrency = useCompanyCurrency();

  const phase = screenPhase(preview, dashboard);
  const showBooks = phase.kind === "ready" && dashboard.data != null && hasBooks(dashboard.data);
  const loading = phase.kind === "loading" || (!previewing && status === "loading" && !showBooks);
  const failed = phase.kind === "error" || previewHidesBand(preview);
  const offline = phase.kind === "error" ? phase.offline : preview === "error";

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

  function retry() {
    if (previewing) {
      void navigate("/?preview=1");
      return;
    }
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <HomeSkeleton preview={previewing} example={example} period={books.period} onPeriod={books.setPeriod} />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks) {
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
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      period={books.period}
      onPeriod={books.setPeriod}
      refreshing={dashboard.isPlaceholderData}
      checklist={<SetupHomeSlot emptyHome={false} />}
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
  onUnpaidRetry,
  period,
  onPeriod,
  example,
  refreshing = false,
  notice,
  checklist,
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
}) {
  const rankCurrency = primaryCurrency(data);
  const ranked = homeProjects(data.projects, rankCurrency);
  const leading = useHeldOrder(ranked, (project) => project.id);
  const currencyRows = companyRows(data, companyCurrency);
  const heroFigures = currencyRows.map((row) => ({
    agorot: roundedHeroProfit(row.income_minor, row.expense_minor),
    currency: row.currency,
    loss: roundedHeroProfit(row.income_minor, row.expense_minor) < 0n,
  }));
  const hero = heroLabelProfit(heroFigures);
  const ilsOnly = currencyRows.length === 1 && currencyRows[0]?.currency === "ILS";
  const previous =
    data.prev_income_agorot != null && data.prev_expense_agorot != null
      ? roundedHeroProfit(data.prev_income_agorot, data.prev_expense_agorot)
      : data.prev_net_agorot;
  const percent = ilsOnly ? changePercent(heroFigures[0]?.agorot ?? 0n, previous) : null;
  const comparison = comparisonWords(period);
  const phrase = periodPhrase(period);
  const attention = attentionRows({
    pending: data.review_count,
    unpaidCount: unpaidPhase === "ready" ? unpaidCount : 0,
    unpaidGross,
    unpaidOther,
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
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        <div className="ui-band-pbar">
          <PeriodBar period={period} onChange={onPeriod} />
        </div>
        {/* FLOW-336: a sideways swipe on the figure steps the period, as the arrows do (decision 0147). */}
        <PeriodSwipe period={period} onChange={onPeriod}>
          <Hero
            label={heroProfitLabel(period, hero)}
            figures={heroFigures}
            explanation={heroExplanation()}
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
      {ilsOnly && comparison && percent != null ? (
        <p className="ui-flow-note">
          <ChangePill percent={percent} comparison={comparison} />
        </p>
      ) : null}

      {checklist}

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

      <SectionHead title="פרויקטים" />
      {leading.length === 0 ? (
        <p className="ui-page-pad t-hint">אין תנועות בפרויקטים בתקופה הזו.</p>
      ) : (
        <ul className="ui-project-list">
          {leading.map((project) => (
            <li key={project.id}>
              <ProjectLine project={project} search={search} rankCurrency={rankCurrency} />
            </li>
          ))}
        </ul>
      )}
      <p className="ui-page-pad">
        <TextLink to={`/projects${search}`} tone="quiet">
          לכל הפרויקטים
        </TextLink>
      </p>
    </div>
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
 * total, each only when it has something. A count of 1 reads singular.
 */
export function attentionRows({
  pending,
  unpaidCount,
  unpaidGross,
  unpaidOther = [],
  search,
}: {
  pending: number;
  unpaidCount: number;
  unpaidGross: bigint;
  unpaidOther?: { currency: string; minor: bigint }[];
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
      title: unpaidCount === 1 ? "חשבונית אחת לא שולמה" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות לא שולמו</>,
      hint: unpaidOther.length === 0 ? (
        <><bdi dir="ltr">{formatIls(unpaidGross)}</bdi> · טרם נגבה</>
      ) : (
        <>
          {[
            ...(unpaidGross !== 0n ? [formatIls(unpaidGross)] : []),
            ...unpaidOther.map((total) => formatAmountText(total.minor, total.currency)),
          ].map((text) => (
            <span key={text}><bdi dir="ltr">{text}</bdi> · </span>
          ))}
          טרם נגבה
        </>
      ),
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
