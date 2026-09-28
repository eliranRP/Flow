import { cx } from "./cx";

const rowKeys = ["a", "b", "c"] as const;

type SkeletonWidth = "sm" | "md" | "lg";

export function Skeleton({
  width = "md",
  tone = "surface",
  hero = false,
}: {
  width?: SkeletonWidth;
  tone?: "surface" | "ui-band";
  hero?: boolean;
}) {
  return <span className={cx("ui-skeleton-bar", tone === "ui-band" && "ui-skeleton-bar-band", hero ? "ui-skeleton-hero" : `skeleton-w-${width}`)} />;
}

export function ListSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <p className="sr-only" role="status">
        טוען…
      </p>
      {rowKeys.map((key) => (
        <div className="ui-skel-row" key={key}>
          <Skeleton width="md" />
          <Skeleton width="sm" />
        </div>
      ))}
    </div>
  );
}
