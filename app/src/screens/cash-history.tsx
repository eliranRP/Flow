import type { CashMonths, CashYears } from "@flow/shared";
import { onlineManager } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import {
  cashHistoryLabel,
  cashHistoryPath,
  cashYearMonthRows,
  cashYearMonths,
  cashYearRows,
  cashYearSummaryRows,
  cashYearTitle,
  cashYearTotals,
  isCashYear,
  shownTotalRows,
} from "../cash";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useCashYearMonthsQuery, useCashYearsQuery } from "../use-cash";
import { BackButton } from "../ui/back";
import { CashRows } from "../ui/cash-rows";
import { ErrorState } from "../ui/error-state";
import { Hero } from "../ui/hero";
import { BandHero, SectionHead } from "../ui/layout";
import { SearchEntry } from "../ui/search-entry";
import { Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

/**
 * FLOW-417 (owner's "Years, then months", decision 0172). Home's "לכל החודשים" opens the
 * history: the net since the first cash month on the band, then a row per year. A year opens its
 * page: its net, נכנס and יצא, then its months, each opening the month's page.
 */

const skeletonRows = ["a", "b", "c", "d"] as const;

/** The band and a few rows while a history page loads. */
export function CashHistorySkeleton({ back, section }: { back: string; section: string }) {
  const search = usePreviewSearch();
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">
        טוען…
      </p>
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} onBand label="חזרה" />}
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        <BandHero>
          <div className="ui-hero">
            <Skeleton tone="band" className="ui-skel-label" />
            <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
          </div>
        </BandHero>
      </TopBand>
      <SectionHead title={section} />
      <div className="ui-flow" aria-hidden="true">
        {skeletonRows.map((key) => (
          <span key={key} className="ui-flow-line">
            <Skeleton className="ui-skel-flow-label" />
            <Skeleton className="ui-skel-figure" />
          </span>
        ))}
      </div>
    </div>
  );
}

function NotReady({ phase, back, section, onRetry }: { phase: ScreenPhase; back: string; section: string; onRetry: () => void }) {
  if (phase.kind === "loading") return <CashHistorySkeleton back={back} section={section} />;
  if (phase.kind === "error") return <ErrorState offline={phase.offline || !onlineManager.isOnline()} onRetry={onRetry} />;
  return <Navigate to={back} replace />;
}

function Band({ back, label, figures }: { back: string; label: string; figures: { agorot: bigint; currency: string; loss: boolean }[] }) {
  const search = usePreviewSearch();
  return (
    <TopBand
      wordmark={false}
      leading={<BackButton fallback={back} onBand label="חזרה" />}
      trailing={<SearchEntry to={`/search${search}`} onBand />}
    >
      <Hero label={label} figures={figures} />
    </TopBand>
  );
}

/** /cash/history: the net since the first cash month, then each year. */
export function CashHistoryScreen({ sample }: { sample?: NonNullable<CashYears> } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const query = useCashYearsQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const back = `/${search}`;
  const data = sample ?? query.data ?? null;
  if (phase.kind !== "ready" || data == null) {
    return (
      <NotReady
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        back={back}
        section="שנים"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const totals = shownTotalRows(data.by_currency, data.base_currency);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <Band
        back={back}
        label={cashHistoryLabel(data.first_month)}
        figures={totals.map((row) => ({ agorot: row.net_minor, currency: row.currency, loss: row.net_minor < 0n }))}
      />
      <SectionHead title="שנים" />
      <CashRows rows={cashYearRows(data, search)} months />
    </div>
  );
}

/** /cash/year/2025: the year's net, נכנס and יצא, then its months. */
export function CashYearScreen({
  sample,
  year: fixedYear,
}: { sample?: { years: NonNullable<CashYears>; months: NonNullable<CashMonths> }; year?: number } = {}) {
  const params = useParams();
  const search = usePreviewSearch();
  const raw = fixedYear != null ? String(fixedYear) : params.year;
  if (!isCashYear(raw)) return <Navigate to={`/${search}`} replace />;
  return <CashYearBody year={Number(raw)} search={search} sample={sample} />;
}

function CashYearBody({
  year,
  search,
  sample,
}: {
  year: number;
  search: string;
  sample?: { years: NonNullable<CashYears>; months: NonNullable<CashMonths> };
}) {
  const preview = useHomePreview();
  const months = useCashYearMonthsQuery(year, sample == null);
  // The history is usually cached (the page opened from it); it trims months before the first one.
  const years = useCashYearsQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, months);
  const back = cashHistoryPath(search);
  const data = sample?.months ?? months.data ?? null;
  if (phase.kind !== "ready" || data == null) {
    return (
      <NotReady
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        back={back}
        section="חודשים"
        onRetry={() => {
          void months.refetch();
        }}
      />
    );
  }
  const firstMonth = (sample?.years ?? years.data)?.first_month;
  const shown = cashYearMonths(data, firstMonth);
  const totals = cashYearTotals(shown, data.base_currency);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <Band
        back={back}
        label={cashYearTitle(year)}
        figures={totals.map((row) => ({ agorot: row.net_minor, currency: row.currency, loss: row.net_minor < 0n }))}
      />
      <CashRows rows={cashYearSummaryRows(year, totals)} />
      <SectionHead title="חודשים" />
      <CashRows rows={cashYearMonthRows(shown, data.base_currency, search)} months />
    </div>
  );
}
