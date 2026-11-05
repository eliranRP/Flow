import { useCallback, useState, type ReactNode } from "react";
import { useScrolledPast } from "./screen-header";
import { safeTopPx } from "./toast-layout";

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLOW-1043 (BUILD-PLAN §3.2): the filter that docks into the compact bar. The screen renders one
 * SegmentedControl in the page inside DockSlot, right under the mark, and the same control (same value, same
 * onChange) in the bar's `dock`; the state lives in the screen. `bar` is the bar's height: 64 on Home's band
 * bar, COMPACT_BAR (44) or DETAIL_BAR (56) elsewhere.
 */
/** How far above the bar's edge a pick parks the mark, so rounding never puts it back in view. */
const DOCK_KEEP = 8;

export function useDockedFilter({ barShown, bar }: { barShown: boolean; bar: number }): {
  /** A callback ref for the zero-height mark placed right above the in-page control. */
  markRef: (node: HTMLElement | null) => void;
  /** The mark has scrolled under the bar while the bar shows. */
  docked: boolean;
  /** After a pick while docked: scrolls so the list's top sits under the bar (smooth; instant under reduced motion). */
  scrollUnderBar: () => void;
} {
  const [mark, setMark] = useState<HTMLElement | null>(null);
  const markRef = useCallback((node: HTMLElement | null) => {
    setMark(node);
  }, []);
  const past = useScrolledPast(mark, barShown, bar);
  const docked = barShown && past;
  const scrollUnderBar = useCallback(() => {
    if (!docked || mark == null || !mark.isConnected) return;
    // The mark lands a few pixels above the bar's edge, not one: a scroll can land on a fraction (a 63.4px landing
    // under a 64px edge on main's story smoke of HomeDocked, v3 keeper 8), and the mark stays past the edge whichever
    // way it rounds, so the filter stays docked.
    const top = mark.getBoundingClientRect().top - (bar + safeTopPx() - DOCK_KEEP);
    window.scrollBy({ top, behavior: reducedMotion() ? "instant" : "smooth" });
  }, [docked, mark, bar]);
  return { markRef, docked, scrollUnderBar };
}

/** Wraps the in-page control: fades it out (160ms) while docked and keeps its height, so the page does not jump. */
export function DockSlot({ docked, children }: { docked: boolean; children: ReactNode }) {
  return (
    <div className="ui-dock-slot" data-docked={docked || undefined} aria-hidden={docked || undefined} inert={docked || undefined}>
      {children}
    </div>
  );
}
