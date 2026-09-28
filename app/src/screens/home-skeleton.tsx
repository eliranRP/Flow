import { BandHero, SectionHead } from "../ui/layout";
import { Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

const rowKeys = ["a", "b", "c"] as const;

/** ld-01. A live load hides the preview label. Preview loading keeps מצב תצוגה (0044). */
export function HomeSkeleton({ preview = false }: { preview?: boolean }) {
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">
        טוען…
      </p>
      <TopBand preview={preview} trailing={<span className="ui-skel-pill" />}>
        <BandHero>
          <div className="ui-skel-band">
            <Skeleton tone="ui-band" width="sm" />
            <Skeleton tone="ui-band" width="md" />
            <Skeleton tone="ui-band" hero />
            <Skeleton tone="ui-band" width="sm" />
            <span className="ui-skel-figures">
              <Skeleton tone="ui-band" width="md" />
              <Skeleton tone="ui-band" width="md" />
            </span>
          </div>
        </BandHero>
      </TopBand>
      <div className="ui-skel-card">
        <Skeleton width="sm" />
        <span className="flex min-w-0 flex-col gap-2">
          <Skeleton width="lg" />
          <Skeleton width="md" />
        </span>
      </div>
      <SectionHead title="פרויקטים מובילים" />
      <div className="ui-project-list">
        {rowKeys.map((key) => (
          <div className="ui-row" key={key}>
            <span className="ui-row-text">
              <Skeleton width="md" />
              <Skeleton width="sm" />
            </span>
            <Skeleton width="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
