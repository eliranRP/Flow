import { formatIls, homeSummarySchema, roundedProfitAgorot, wholeShekels, type Dashboard, type ProjectRow } from "@flow/shared";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ChangePill } from "../ui/change-pill";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { ChartIcon } from "../ui/icons";
import { BandFigures, BandHero, SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodPicker, RangeSheet } from "../ui/period-picker";
import { HomeSkeleton } from "./home-skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { homeGreeting, profitBandLabel } from "../home-label";
import { getSupabase } from "../lib/supabase";
import {
  allTime,
  comparisonWords,
  customRange,
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
import { useBooks, useDashboardQuery, useUnpaidQuery } from "../use-books";

function readOwnerName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fullName = "full_name" in metadata ? metadata.full_name : undefined;
  const name = "name" in metadata ? metadata.name : undefined;
  const raw = fullName ?? name;
  return typeof raw === "string" ? raw : null;
}

function changePercent(current: bigint, previous: bigint | null): number | null {
  if (previous == null || previous === 0n) return null;
  const currentShekels = wholeShekels(current);
  const previousShekels = wholeShekels(previous);
  if (previousShekels === 0) return null;
  return Math.round(((currentShekels - previousShekels) / Math.abs(previousShekels)) * 100);
}

export function HomeScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status, session } = useAuth();
  const supabase = getSupabase();
  const previewing = preview !== "off";
  const books = useBooks();
  const dashboard = useDashboardQuery();
  const unpaid = useUnpaidQuery();

  const home = useQuery({
    queryKey: ["home"],
    enabled: !previewing && status === "authed" && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("get_home");
      if (error) throw error;
      return homeSummarySchema.parse(data);
    },
  });

  const phase = screenPhase(preview, dashboard);
  const showBooks = phase.kind === "ready" && dashboard.data != null && hasBooks(dashboard.data);
  const loading = phase.kind === "loading" || (!previewing && status === "loading" && !showBooks);
  const failed = phase.kind === "error" || previewHidesBand(preview);
  const offline = phase.kind === "error" ? phase.offline : preview === "error";
  const greeting = homeGreeting(readOwnerName(session?.user.user_metadata));

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
    void home.refetch();
    void dashboard.refetch();
    void unpaid.refetch();
  }

  if (loading) return <HomeSkeleton />;

  if (failed) {
    return <ErrorState offline={offline || !onlineManager.isOnline()} onRetry={retry} />;
  }

  if (!showBooks) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <TopBand preview={previewing}>
          <BandHero>
            <p className="t-title-2">{greeting}</p>
            <h1 className="ui-band-label t-label">{profitBandLabel(false)}</h1>
          </BandHero>
        </TopBand>
        <EmptyState
          icon={<ChartIcon />}
          title="עוד אין נתונים"
          body="מעלים דוח Excel מאפליקציית פועלים, ובונים ממנו רווח והפסד תוך דקה."
          action={
            <Button variant="pill" to={`/add${search}`}>
              העלאת דוח בנק
            </Button>
          }
        />
      </div>
    );
  }

  const unpaidPhase = screenPhase(preview, unpaid);
  return (
    <HomeBooks
      data={dashboard.data}
      greeting={greeting}
      previewing={previewing}
      search={search}
      unpaidNet={unpaidPhase.kind === "ready" ? (unpaid.data ?? []).reduce((sum, row) => sum + row.open_net_agorot, 0n) : 0n}
      unpaidCount={unpaidPhase.kind === "ready" ? (unpaid.data?.length ?? 0) : 0}
      unpaidPhase={unpaidPhase.kind}
      onUnpaidRetry={() => {
        void unpaid.refetch();
      }}
      period={books.period}
      onPeriod={books.setPeriod}
    />
  );
}

function hasBooks(data: Dashboard): boolean {
  return data.projects.length > 0 || data.income_agorot !== 0n || data.expense_agorot !== 0n;
}

export function HomeBooks({
  data,
  greeting,
  previewing,
  search,
  unpaidNet,
  unpaidCount,
  unpaidPhase = "ready",
  onUnpaidRetry,
  period,
  onPeriod,
}: {
  data: Dashboard;
  greeting: string;
  previewing: boolean;
  search: string;
  unpaidNet: bigint;
  unpaidCount: number;
  unpaidPhase?: "loading" | "error" | "empty" | "ready";
  onUnpaidRetry?: () => void;
  period: PeriodChoice;
  onPeriod: (choice: PeriodChoice) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState(false);
  const leading = [...data.projects].sort((a, b) => (a.profit_agorot < b.profit_agorot ? 1 : a.profit_agorot > b.profit_agorot ? -1 : 0)).slice(0, 3);
  const hero = roundedProfitAgorot(data.income_agorot, data.expense_agorot);
  const previous =
    data.prev_income_agorot != null && data.prev_expense_agorot != null
      ? roundedProfitAgorot(data.prev_income_agorot, data.prev_expense_agorot)
      : data.prev_net_agorot;
  const percent = changePercent(hero, previous);
  const comparison = comparisonWords(period);
  const pending = data.review_count;
  const unpaidReady = unpaidPhase === "ready";
  const showCard = pending > 0 || (unpaidReady && unpaidCount > 0);
  const cardTo = pending > 0 ? `/review${search}` : `/unpaid${search}`;
  const cardTitle = pending > 0 ? `${String(pending)} פריטים ממתינים לאישור` : `${String(unpaidCount)} חשבוניות לא שולמו`;
  const cardHint = unpaidHint(pending, unpaidCount, unpaidNet, unpaidReady);

  const choices = [thisMonth(), lastMonth(), yearToDate(), allTime()];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        preview={previewing}
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
        <BandHero>
          <p className="t-title-2">{greeting}</p>
          <p className="ui-band-label t-label">{heroProfitLabel(period)}</p>
          <h1>
            <BigNumber agorot={hero} size="hero" />
          </h1>
          {comparison && percent != null ? <ChangePill percent={percent} comparison={comparison} onBand /> : null}
          <BandFigures income={formatIls(data.income_agorot)} expense={formatIls(data.expense_agorot)} />
        </BandHero>
      </TopBand>

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

function unpaidHint(pending: number, unpaidCount: number, unpaidNet: bigint, ready: boolean): string | undefined {
  if (!ready || unpaidCount === 0) return undefined;
  const amount = formatIls(unpaidNet);
  if (pending > 0) return `${String(unpaidCount)} חשבוניות לא שולמו · ${amount}`;
  return `${amount} · לא נכלל ברווח`;
}

function ProjectLine({ project, search }: { project: ProjectRow; search: string }) {
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={marginHint(project)}
      agorot={project.profit_agorot}
      loss={project.profit_agorot < 0n}
      href={`/projects/${project.id}${search}`}
    />
  );
}

function marginHint(project: ProjectRow): string | undefined {
  if (project.income_agorot <= 0n) return undefined;
  const pct = Number((project.profit_agorot * 100n) / project.income_agorot);
  return pct < 0 ? `רווחיות −${String(Math.abs(pct))}%` : `רווחיות ${String(pct)}%`;
}
