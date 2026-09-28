import { cx } from "./cx";
import { BandHero } from "./layout";
import { TopBand } from "./top-band";

const rowKeys = ["a", "b", "c"] as const;

type SkeletonWidth = "sm" | "md" | "lg";

export function Skeleton({ width = "md", tone = "surface" }: { width?: SkeletonWidth; tone?: "surface" | "band" }) {
  return <span className={cx("skeleton-bar", tone === "band" && "skeleton-bar-band", `skeleton-w-${width}`)} />;
}

/** Loading Home matches the band: greeting, label, figure, change, income and expenses, then the pending card and three rows. */
export function HomeSkeleton({ previewing = false }: { previewing?: boolean }) {
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <TopBand preview={previewing}>
        <BandHero>
          <Skeleton tone="band" width="md" />
          <Skeleton tone="band" width="sm" />
          <Skeleton tone="band" width="lg" />
          <Skeleton tone="band" width="sm" />
          <span className="flex gap-6">
            <Skeleton tone="band" width="md" />
            <Skeleton tone="band" width="md" />
          </span>
        </BandHero>
      </TopBand>
      <div className="page-pad">
        <Skeleton width="lg" />
      </div>
      <h2 className="t-title-3 page-pad">פרויקטים מובילים</h2>
      <div className="project-list">
        {rowKeys.map((key) => (
          <div className="ui-skel-row" key={key}>
            <Skeleton width="md" />
            <Skeleton width="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
