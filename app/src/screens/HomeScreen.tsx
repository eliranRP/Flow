import { formatIls, wholeShekels, type Dashboard, type ProjectRow } from "@flow/shared";
import {
  companyRows,
  dashboardHasBooks,
  heroLabelProfit,
  primaryCurrency,
  profitInCurrency,
  projectAmountFigures,
  projectMarginHint,
  roundedHeroProfit,
} from "../by-currency";
import { onlineManager } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useHeldOrder } from "../list-hold";
import { useNavigate } from "react-router-dom";
import { absAgorot } from "../agorot";
import { useAuth } from "../auth";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { ChangePill } from "../ui/change-pill";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { FlowLines, Hero } from "../ui/hero";
import { ChartIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodPicker, RangeSheet } from "../ui/period-picker";
import { HomeSkeleton } from "./home-skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { emptyHomeLabel } from "../home-label";
import {
  allTime,
  comparisonWords,
  customRange,
  heroExplanation,
  heroProfitLabel,
  lastMonth,
  periodHint,
  periodLabel,
  samePeriod,
  thisMonth,
  yearToDate,
  type PeriodChoice,
} from "../period";
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

  if (loading) return <HomeSkeleton preview={previewing} example={example} />;

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
          body="הרווח יופיע כאן אחרי ש־SUMIT מחובר."
          action={holdWrites ? undefined : (
            <Button variant="pill" to={previewing ? `/settings${search}` : "/setup/1?from=card"}>
              חיבור SUMIT
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
      data={dashboard.data}
      previewing={previewing}
      search={search}
      unpaidGross={unpaidPhase.kind === "ready" ? (unpaid.data ?? []).reduce((sum, row) => sum + absAgorot(row.open_gross_agorot), 0n) : 0n}
      unpaidCount={unpaidPhase.kind === "ready" ? (unpaid.data?.length ?? 0) : 0}
      unpaidPhase={unpaidPhase.kind}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      period={books.period}
      onPeriod={books.setPeriod}
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
  unpaidPhase = "ready",
  onUnpaidRetry,
  period,
  onPeriod,
  example,
  refreshing = false,
  notice,
  checklist,
}: {
  data: Dashboard;
  previewing: boolean;
  search: string;
  unpaidGross: bigint;
  unpaidCount: number;
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
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState(false);
  const rankCurrency = primaryCurrency(data);
  const ranked = [...data.projects]
    .sort((a, b) => {
      const left = profitInCurrency(a, rankCurrency);
      const right = profitInCurrency(b, rankCurrency);
      return left < right ? 1 : left > right ? -1 : 0;
    })
    .slice(0, 3);
  const leading = useHeldOrder(ranked, (project) => project.id);
  const currencyRows = companyRows(data);
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
  const pending = data.review_count;
  const unpaidReady = unpaidPhase === "ready";
  const showCard = pending > 0 || (unpaidReady && unpaidCount > 0);
  const cardTo = pending > 0 ? `/review${search}` : `/unpaid${search}`;
  const cardTitle = pending > 0
    ? <><bdi dir="ltr">{String(pending)}</bdi> פריטים ממתינים לאישור</>
    : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות לא שולמו</>;
  const cardHint = unpaidHint(pending, unpaidCount, unpaidGross, unpaidReady);

  const choices = [thisMonth(), lastMonth(), yearToDate(), allTime()];

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
        trailing={
          <PeriodPicker
            pill={periodLabel(period)}
            open={sheet}
            onOpenChange={setSheet}
            onCustom={() => {
              setRange(true);
            }}
            options={choices.map((choice) => ({
              label: periodLabel(choice),
              hint: periodHint(choice),
              selected: samePeriod(choice, period),
              onSelect: () => {
                onPeriod(choice);
              },
            }))}
          />
        }
      >
        <Hero
          label={heroProfitLabel(period, hero)}
          figures={heroFigures}
          explanation={heroExplanation(period)}
        />
      </TopBand>

      {notice}

      <FlowLines
        lines={currencyRows.map((row) => ({
          currency: row.currency,
          income: row.income_minor,
          expense: row.expense_minor,
        }))}
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

      {showCard ? <Banner to={cardTo} title={cardTitle} hint={cardHint} /> : null}

      <SectionHead title="פרויקטים מובילים" />
      <ul className="ui-project-list">
        {leading.map((project) => (
          <li key={project.id}>
            <ProjectLine project={project} search={search} />
          </li>
        ))}
      </ul>
      <p className="ui-page-pad">
        <TextLink to={`/projects${search}`} tone="quiet">
          לכל הפרויקטים
        </TextLink>
      </p>
      <RangeSheet
        open={range}
        onOpenChange={setRange}
        onApply={(from, to) => {
          onPeriod(customRange(from, to));
        }}
      />
    </div>
  );
}

function unpaidHint(pending: number, unpaidCount: number, unpaidGross: bigint, ready: boolean): ReactNode {
  if (!ready || unpaidCount === 0) return undefined;
  const amount = <bdi dir="ltr">{formatIls(unpaidGross)}</bdi>;
  if (pending > 0) return <>{String(unpaidCount)} חשבוניות לא שולמו · {amount}</>;
  return <>{amount} · טרם נגבה</>;
}

function ProjectLine({ project, search }: { project: ProjectRow; search: string }) {
  const amounts = projectAmountFigures(project);
  const single = amounts.length === 1 ? amounts[0] : undefined;
  const margin = projectMarginHint(project);
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={margin == null ? undefined : (
        <>
          רווחיות <bdi dir="ltr">{margin}</bdi>
        </>
      )}
      agorot={single?.minor ?? project.profit_agorot}
      currency={single?.currency}
      amounts={amounts.length > 1 ? amounts : undefined}
      loss={(single?.minor ?? project.profit_agorot) < 0n}
      href={`/projects/${project.id}${search}`}
    />
  );
}
