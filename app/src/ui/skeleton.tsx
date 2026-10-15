import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";

const rowKeys = ["a", "b", "c", "d", "e", "f"] as const;

type SkeletonWidth = "sm" | "md" | "lg";

/** Nothing shows before this (FLOW-371). Mirrors --skeleton-delay in implementation-tokens.css. */
export const SKELETON_DELAY_MS = 300;

/** False for the first `ms` after mount, then true. A load that ends sooner never shows a skeleton. */
export function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = window.setTimeout(() => {
      setElapsed(true);
    }, ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ms]);
  return elapsed;
}

/** Renders its children only after the skeleton delay: a fast load shows nothing at all. */
export function DelayedSkeleton({ children }: { children: ReactNode }) {
  const shown = useElapsed(SKELETON_DELAY_MS);
  return shown ? <>{children}</> : null;
}

export function Skeleton({
  width = "md",
  tone = "surface",
  hero = false,
  still = false,
  className,
}: {
  width?: SkeletonWidth;
  tone?: "surface" | "band";
  hero?: boolean;
  /** No shine: for a storyboard frame, not a load (FLOW-506). */
  still?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "ui-skeleton-bar",
        tone === "band" && "ui-skeleton-bar-band",
        still && "ui-skeleton-bar-still",
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
