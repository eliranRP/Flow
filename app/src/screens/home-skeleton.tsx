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

/**
 * FLOW-364: Home's cash while it loads, in the shape it lands in: the band (the company, the icons
 * and the month pill are real; the figures are band bars), then the split card and the box as blocks.
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
        <p className="ui-band-month-name">
          <span>{homeMonthLabel(currentKey)}</span>
        </p>
        <div className="ui-home-figures" aria-hidden="true">
          <DelayedSkeleton>
            <Skeleton tone="band" className="ui-skel-label" />
            <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
            <div className="ui-band-rows">
              <Skeleton tone="band" className="ui-skel-figure" />
              <Skeleton tone="band" className="ui-skel-figure" />
            </div>
          </DelayedSkeleton>
        </div>
      </TopBand>
      <DelayedSkeleton>
        <div className="ui-home-split" aria-hidden="true">
          <Skeleton width="lg" className="ui-skel-label" />
          <Skeleton className="ui-skel-figure" />
        </div>
        <div className="ui-skel-card" aria-hidden="true">
          <Skeleton className="ui-skel-dot" />
          <span className="ui-skel-copy">
            <Skeleton width="lg" />
            <Skeleton width="md" />
          </span>
        </div>
      </DelayedSkeleton>
    </div>
  );
}
