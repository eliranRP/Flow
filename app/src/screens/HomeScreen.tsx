import { formatIls, homeSummarySchema, type Dashboard, type ProjectRow } from "@flow/shared";
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
import { BandHero, SectionHead } from "../ui/layout";
import { ListRow } from "../ui/list-row";
import { PeriodPicker, RangeSheet } from "../ui/period-picker";
import { HomeSkeleton } from "../ui/skeleton";
import { TextLink } from "../ui/text-link";
import { TopBand } from "../ui/top-band";
import { homeGreeting, profitBandLabel } from "../home-label";
import { getSupabase } from "../lib/supabase";
import { allTime, comparisonWords, customRange, heroProfitLabel, lastMonth, periodHint, thisMonth, yearToDate, type PeriodChoice } from "../period";
import { previewHidesBand, useHomePreview, usePreviewSearch } from "../preview";
import { useBooks, useDashboardQuery, useUnpaidQuery } from "../use-books";

function readOwnerName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fullName = "full_name" in metadata ? metadata.full_name : undefined;
  const name = "name" in metadata ? metadata.name : undefined;
  const raw = fullName ?? name;
  return typeof raw === "string" ? raw : null;
}

function ag(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function changePercent(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
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

  const showBooks = !previewing && dashboard.data != null && hasBooks(dashboard.data);
  const loading =
    preview === "loading" ||
    (!previewing && (status === "loading" || ((home.isLoading || dashboard.isLoading) && !showBooks)));
  const liveOffline =
    !previewing &&
    (home.isPaused || dashboard.isPaused || ((home.isError || dashboard.isError) && !onlineManager.isOnline()));
  const liveServer =
    !previewing &&
    (home.isError || dashboard.isError) &&
    !home.isPaused &&
    !dashboard.isPaused &&
    onlineManager.isOnline();
  const offline = preview === "error" || liveOffline;
  const failed = previewHidesBand(preview) || liveOffline || liveServer;
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
  }

  if (loading) return <HomeSkeleton previewing={previewing} />;

  if (failed) {
    return <ErrorState offline={offline} onRetry={retry} />;
  }

  if (!showBooks) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <TopBand preview={previewing}>
          <BandHero>
            <p className="t-title-2">{greeting}</p>
            <h1 className="band-label t-label">{profitBandLabel(false)}</h1>
          </BandHero>
        </TopBand>
        <EmptyState
          icon={<ChartIcon />}
          title="עוד אין נתונים"
          body="הרווח יופיע כאן אחרי ש-SUMIT מחובר."
          action={
            <Button variant="pill" to={`/settings${search}`}>
              חיבור SUMIT
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <HomeBooks
      data={dashboard.data}
      greeting={greeting}
      previewing={previewing}
      search={search}
      unpaidNet={unpaid.data?.reduce((sum, row) => sum + row.open_net_agorot, 0) ?? 0}
      unpaidCount={unpaid.data?.length ?? 0}
      period={books.period}
      onPeriod={books.setPeriod}
    />
  );
}

function hasBooks(data: Dashboard): boolean {
  return data.projects.length > 0 || data.income_agorot !== 0 || data.expense_agorot !== 0;
}

export function HomeBooks({
  data,
  greeting,
  previewing,
  search,
  unpaidNet,
  unpaidCount,
  period,
  onPeriod,
}: {
  data: Dashboard;
  greeting: string;
  previewing: boolean;
  search: string;
  unpaidNet: number;
  unpaidCount: number;
  period: PeriodChoice;
  onPeriod: (choice: PeriodChoice) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState(false);
  const leading = [...data.projects].sort((a, b) => b.profit_agorot - a.profit_agorot).slice(0, 3);
  const percent = changePercent(data.net_profit_agorot, data.prev_net_agorot);
  const comparison = comparisonWords(period);
  const pending = data.review_count;
  const showCard = pending > 0 || unpaidCount > 0;
  const cardTo = pending > 0 ? `/review${search}` : `/unpaid${search}`;
  const cardTitle = pending > 0 ? `${String(pending)} פריטים ממתינים לאישור` : `${String(unpaidCount)} חשבוניות לא שולמו`;
  const cardHint =
    pending > 0 && unpaidCount > 0
      ? `${String(unpaidCount)} חשבוניות לא שולמו · ${formatIls(ag(unpaidNet))}`
      : pending === 0
        ? "לא נכלל ברווח"
        : undefined;

  const choices = [thisMonth(), lastMonth(), yearToDate(), allTime()];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        preview={previewing}
        trailing={
          <PeriodPicker
            pill={period.label}
            open={sheet}
            onOpenChange={setSheet}
            onCustom={() => {
              setRange(true);
            }}
            options={choices.map((choice) => ({
              label: choice.label,
              hint: periodHint(choice),
              selected: choice.label === period.label,
              onSelect: () => {
                onPeriod(choice);
              },
            }))}
          />
        }
      >
        <BandHero>
          <p className="t-title-2">{greeting}</p>
          <p className="band-label t-label">{heroProfitLabel(period)}</p>
          <h1 className="t-hero">
            <BigNumber agorot={ag(data.net_profit_agorot)} />
          </h1>
          {comparison && percent != null ? <ChangePill percent={percent} comparison={comparison} onBand /> : null}
          <div className="band-figures">
            <span>
              הכנסות
              <bdi dir="ltr">{formatIls(ag(data.income_agorot))}</bdi>
            </span>
            <span>
              הוצאות
              <bdi dir="ltr">{formatIls(ag(data.expense_agorot))}</bdi>
            </span>
          </div>
        </BandHero>
      </TopBand>

      {showCard ? <Banner to={cardTo} title={cardTitle} hint={cardHint} /> : null}

      <SectionHead title="פרויקטים מובילים" />
      <ul className="project-list">
        {leading.map((project) => (
          <li key={project.id}>
            <ProjectLine project={project} search={search} />
          </li>
        ))}
      </ul>
      <p className="page-pad">
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

function ProjectLine({ project, search }: { project: ProjectRow; search: string }) {
  return (
    <ListRow
      variant="project"
      title={project.name}
      hint={marginHint(project)}
      agorot={ag(project.profit_agorot)}
      loss={project.profit_agorot < 0}
      href={`/projects/${project.id}${search}`}
    />
  );
}

function marginHint(project: ProjectRow): string | undefined {
  if (project.income_agorot <= 0) return undefined;
  const pct = Math.round((project.profit_agorot / project.income_agorot) * 100);
  return pct < 0 ? `רווחיות −${String(Math.abs(pct))}%` : `רווחיות ${String(pct)}%`;
}
