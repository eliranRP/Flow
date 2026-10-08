import { useState, type ReactNode } from "react";
import { BandHero, SectionHead } from "../ui/layout";
import { PeriodBar } from "../ui/period-bar";
import { SearchEntry } from "../ui/search-entry";
import { usePreviewSearch } from "../preview";
import { defaultPeriod, type PeriodChoice } from "../period";
import { ListRow } from "../ui/list-row";
import { Skeleton } from "../ui/skeleton";
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
  /** Home's period. The bar is real while the figures load, so a period can change meanwhile. */
  period?: PeriodChoice;
  onPeriod?: (period: PeriodChoice) => void;
}) {
  const [own, setOwn] = useState<PeriodChoice>(() => defaultPeriod());
  const search = usePreviewSearch();
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">
        טוען…
      </p>
      <TopBand
        wordmark={false}
        preview={preview}
        example={example}
        trailing={<SearchEntry to={`/search${search}`} onBand />}
      >
        <div className="ui-band-pbar">
          <PeriodBar period={period ?? own} onChange={onPeriod ?? setOwn} />
        </div>
        <BandHero>
          <div className="ui-hero" aria-hidden="true">
            <Skeleton tone="band" className="ui-skel-label" />
            <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
            <Skeleton tone="band" className="ui-skel-explain" />
          </div>
        </BandHero>
      </TopBand>
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
      <div className="ui-skel-card">
        <Skeleton className="ui-skel-dot" />
        <span className="ui-skel-copy">
          <Skeleton width="lg" />
          <Skeleton width="md" />
        </span>
      </div>
      <SectionHead title="פרויקטים" />
      <div className="ui-project-list">
        {rowKeys.map((key) => (
          <ListRow variant="skeleton" key={key} />
        ))}
      </div>
    </div>
  );
}
