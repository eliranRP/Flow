import { BandHero } from "../ui/layout";
import { Skeleton } from "../ui/skeleton";
import { TopBand } from "../ui/top-band";

const rowKeys = ["a", "b", "c"] as const;

/** ld-01. The preview label stays off: a skeleton is not a demo frame. */
export function HomeSkeleton() {
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <TopBand>
        <BandHero>
          <Skeleton tone="ui-band" width="sm" />
          <Skeleton tone="ui-band" width="lg" />
          <span className="flex gap-2">
            <Skeleton tone="ui-band" width="sm" />
            <Skeleton tone="ui-band" width="md" />
          </span>
          <span className="flex gap-6">
            <Skeleton tone="ui-band" width="md" />
            <Skeleton tone="ui-band" width="md" />
          </span>
        </BandHero>
      </TopBand>
      <div className="ui-page-pad">
        <Skeleton width="lg" />
      </div>
      <h2 className="t-title-3 ui-page-pad">פרויקטים מובילים</h2>
      <div className="ui-project-list">
        {rowKeys.map((key) => (
          <div className="ui-skel-row" key={key}>
            <span className="ui-stack">
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
