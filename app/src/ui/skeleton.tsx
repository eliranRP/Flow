import { cx } from "./cx";

const rowKeys = ["a", "b", "c", "d", "e", "f"] as const;

type SkeletonWidth = "sm" | "md" | "lg";

export function Skeleton({
  width = "md",
  tone = "surface",
  hero = false,
  className,
}: {
  width?: SkeletonWidth;
  tone?: "surface" | "band";
  hero?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "ui-skeleton-bar",
        tone === "band" && "ui-skeleton-bar-band",
        className ? null : hero ? "ui-skeleton-hero" : `ui-skeleton-w-${width}`,
        className,
      )}
    />
  );
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
