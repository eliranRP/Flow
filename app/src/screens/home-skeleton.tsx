import { useState, type ReactNode } from "react";
import { BandHero, SectionHead } from "../ui/layout";
import { PeriodPicker } from "../ui/period-picker";
import { SearchEntry } from "../ui/search-entry";
import { usePreviewSearch } from "../preview";
import { israelToday } from "../ui/date-math";
import { HomeBandActions, homeMonthLabel } from "./home-parts";
import { defaultPeriod, windowLabel, type PeriodChoice } from "../period";
import { ListRow } from "../ui/list-row";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

const rowKeys = ["a", "b", "c"] as const;

/** ld-01. A live load hides the preview label. Preview loading keeps מצב תצוגה (0044). */
export function HomeSkeleton({
  preview = false,
  example,
  period,
  onPeriod,
}: {
  preview?: boolean;
  example?: ReactNode;
  /** Home's period. The pill is real while the figures load, so a period can change meanwhile. */
  period?: PeriodChoice;
  onPeriod?: (period: PeriodChoice) => void;
}) {
  const [own, setOwn] = useState<PeriodChoice>(() => defaultPeriod());
  const [sheet, setSheet] = useState(false);
  const shown = period ?? own;
  const search = usePreviewSearch();
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <DelayedSkeleton>
        <p className="sr-only" role="status">
          טוען…
        </p>
      </DelayedSkeleton>
      <TopBand
        wordmark={false}
        preview={preview}
        example={example}
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        <BandHero>
          <div className="ui-hero">
            <DelayedSkeleton>
              <Skeleton tone="band" className="ui-skel-label" />
            </DelayedSkeleton>
            {/* FLOW-355: the pill is real while the figures load, so a period can change meanwhile. */}
            <div className="ui-hero-pill">
              <PeriodPicker pill={windowLabel(shown)} name={`${windowLabel(shown)} – בחירת תקופה`} open={sheet} onOpenChange={setSheet} period={shown} onChange={onPeriod ?? setOwn} />
            </div>
            <DelayedSkeleton>
              <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
            </DelayedSkeleton>
          </div>
        </BandHero>
      </TopBand>
      <DelayedSkeleton>
        <div className="ui-flow" aria-hidden="true">
          <span className="ui-flow-line">
            <Skeleton className="ui-skel-flow-label" />
            <Skeleton className="ui-skel-figure" />
          </span>
          <span className="ui-flow-line">
            <Skeleton className="ui-skel-flow-label" />
            <Skeleton className="ui-skel-figure" />
          </span>
        </div>
        <SectionHead title="פרויקטים" />
        <div className="ui-project-list">
          {rowKeys.slice(0, 2).map((key) => (
            <ListRow variant="skeleton" key={key} />
          ))}
        </div>
        {/* FLOW-355: the attention card loads where it lands, under the first two projects. */}
        <div className="ui-skel-card">
          <Skeleton className="ui-skel-dot" />
          <span className="ui-skel-copy">
            <Skeleton width="lg" />
            <Skeleton width="md" />
          </span>
        </div>
        <div className="ui-project-list">
          {rowKeys.slice(2).map((key) => (
            <ListRow variant="skeleton" key={key} />
          ))}
        </div>
      </DelayedSkeleton>
    </div>
  );
}

/** FLOW-375 (board, States homeLoading): a skeleton row of the attention box and the third block: an icon slot, copy, a trailing bar. */
function CashSkeletonRow() {
  return (
    <div className="ui-skel-row">
      <Skeleton className="ui-skel-row-dot" />
      <span className="ui-skel-copy">
        <Skeleton className="ui-skel-line-a" />
        <Skeleton className="ui-skel-line-b" />
      </span>
      <Skeleton className="ui-skel-row-trail" />
    </div>
  );
}

/**
 * FLOW-364 / FLOW-375: Home's cash while it loads, in the shape it lands in: the band (the company, the icons
 * and the month pill are real; the figures are band bars), the split card and the attention box at the loaded
 * Home's geometry, then the board's third block (a title and three rows).
 */
export function CashHomeSkeleton({ preview = false, example }: { preview?: boolean; example?: ReactNode }) {
  const search = usePreviewSearch();
  const currentKey = israelToday().slice(0, 7);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <DelayedSkeleton>
        <p className="sr-only" role="status">
          טוען…
        </p>
      </DelayedSkeleton>
      <TopBand
        wordmark={false}
        preview={preview}
        example={example}
        leading={
          <DelayedSkeleton>
            <Skeleton tone="band" className="ui-skel-label" />
          </DelayedSkeleton>
        }
        trailing={<HomeBandActions isPast={false} currentName="" search={search} />}
      >
        <div className="ui-band-body">
          <p className="ui-band-month-static">{homeMonthLabel(currentKey)}</p>
          <DelayedSkeleton>
            <div className="ui-home-figures ui-skel-band-figs" aria-hidden="true">
              <Skeleton tone="band" className="ui-skel-band-label" />
              <Skeleton tone="band" className="ui-skel-band-hero" />
              <Skeleton tone="band" className="ui-skel-band-caption" />
              <div className="ui-skel-band-rows">
                <div className="ui-skel-band-row">
                  <Skeleton tone="band" className="ui-skel-band-row-a" />
                  <Skeleton tone="band" className="ui-skel-band-row-b" />
                </div>
                <div className="ui-skel-band-row">
                  <Skeleton tone="band" className="ui-skel-band-row-a" />
                  <Skeleton tone="band" className="ui-skel-band-row-b" />
                </div>
              </div>
            </div>
          </DelayedSkeleton>
        </div>
      </TopBand>
      <DelayedSkeleton>
        <section className="ui-home-split" aria-hidden="true">
          <Skeleton className="ui-skel-split-title" />
          <Skeleton className="ui-skel-split-bar" />
          <div className="ui-skel-split-row">
            <Skeleton className="ui-skel-split-a" />
            <Skeleton className="ui-skel-split-b" />
          </div>
        </section>
        <section className="ui-home-attention ui-skel-attention" aria-hidden="true">
          <Skeleton className="ui-skel-attention-title" />
          <div className="ui-skel-attention-rows">
            <CashSkeletonRow />
            <CashSkeletonRow />
          </div>
        </section>
        <div className="ui-skel-list" aria-hidden="true">
          <Skeleton className="ui-skel-list-title" />
          <CashSkeletonRow />
          <CashSkeletonRow />
          <CashSkeletonRow />
        </div>
      </DelayedSkeleton>
    </div>
  );
}
