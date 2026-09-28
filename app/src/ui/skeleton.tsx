import { cx } from "./cx";
import { BandHero, SectionHead } from "./layout";
import { TopBand } from "./top-band";

const rowKeys = ["a", "b", "c"] as const;

type SkeletonWidth = "sm" | "md" | "lg";

export function Skeleton({ width = "md", tone = "surface" }: { width?: SkeletonWidth; tone?: "surface" | "band" }) {
  return <span className={cx("skeleton-bar", tone === "band" && "skeleton-bar-band", `skeleton-w-${width}`)} />;
}

export function Loader({ label = "טוען…" }: { label?: string }) {
  return (
    <p className="ui-hit" role="status" aria-busy="true">
      <span className="ui-spinner" aria-hidden="true" /> {label}
    </p>
  );
}

/** Loading Home: real band chrome, generic bars for the figures and the project rows. */
export function HomeSkeleton({ previewing = false }: { previewing?: boolean }) {
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only">טוען…</p>
      <TopBand preview={previewing}>
        <BandHero>
          <Skeleton tone="band" width="md" />
          <Skeleton tone="band" width="lg" />
          <Skeleton tone="band" width="sm" />
        </BandHero>
      </TopBand>
      <SectionHead title="פרויקטים מובילים" />
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
