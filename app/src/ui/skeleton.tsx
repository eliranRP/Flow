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

/** The skeleton fades out over this long when its load ends (FLOW-371, board States homeReveal). */
export const SKELETON_FADE_MS = 200;

/** True once `active` has been on for `ms`; false again as soon as it turns off. */
function useHeldFor(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) {
      setHeld(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setHeld(true);
    }, ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, ms]);
  return held;
}

/** True while `active`, and for `ms` after it turns off. */
function useLingering(active: boolean, ms: number): boolean {
  const [lingering, setLingering] = useState(active);
  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setLingering(false);
    }, ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, ms]);
  return lingering || active;
}

/**
 * A load's skeleton (FLOW-371): nothing for the first 300ms, then the skeleton while `loading`. When
 * the load ends, a skeleton that was on screen fades out over 200ms, as the content fades in. A load
 * that ends within 300ms never shows one.
 */
export function SkeletonSwap({ loading, children }: { loading: boolean; children: ReactNode }) {
  const held = useHeldFor(loading, SKELETON_DELAY_MS);
  const lingering = useLingering(held, SKELETON_FADE_MS);
  if (loading) return held ? <>{children}</> : null;
  return lingering ? (
    <div className="ui-skel-leaving" aria-hidden="true">
      {children}
    </div>
  ) : null;
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
