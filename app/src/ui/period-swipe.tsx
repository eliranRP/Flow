import { useRef, type ReactNode, type TouchEvent } from "react";
import { canStep, stepPeriod, type PeriodChoice } from "../period";
import { cx } from "./cx";
import { EDGE_PX } from "./edge-back";

/**
 * FLOW-336 (decision 0150): a sideways swipe on the band's profit figure steps the period by the
 * preset's length, as the stepper arrows do. The rules are FLOW-314's, so the transaction swipe and
 * gestures that start at the screen edges never fight it:
 * - touch only, one finger;
 * - a start within EDGE_PX of either screen edge is left alone (edge gestures such as a future swipe-back start there);
 * - a start inside a field or a sheet, or while a sheet is open, is left alone;
 * - nothing is decided until the finger moved DECIDE_PX; a mostly vertical move goes to the page scroll;
 * - it commits past COMMIT_RATIO of the figure's width, or on a flick;
 * - the figure follows the finger; with reduced motion it stays put and the period swaps on release.
 *
 * Direction follows the arrows. The arrow on the start side (right, in RTL) points right and goes
 * earlier, so a finger moving right, toward that arrow, goes earlier; moving left goes later. The
 * later step stops at the current window, like the disabled later arrow.
 */
// The same edge zone as swipe-back (FLOW-332) and the card swipe (FLOW-314).
export { EDGE_PX };
export const DECIDE_PX = 10;
export const COMMIT_RATIO = 0.3;
/** A flick: at least this fast (px per ms) over at least FLICK_MIN_PX. */
export const FLICK_SPEED = 0.5;
export const FLICK_MIN_PX = 30;
/** How far the figure follows the finger, as a share of the move. */
const FOLLOW = 0.5;
/** At the current window the later side barely gives, so the figure says "no further". */
const FOLLOW_BLOCKED = 0.15;

export type SwipeAxis = "x" | "y" | null;

/** Decides the axis once the finger moved far enough; null until then. */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** True when a touch starts within the edge zone of either side of the screen. */
export function inEdgeZone(x: number, viewportWidth: number): boolean {
  return x <= EDGE_PX || x >= viewportWidth - EDGE_PX;
}

/**
 * The step a finished horizontal move asks for: -1 earlier (finger moved right, toward the start
 * arrow), +1 later (finger moved left), or 0 when it was too short and too slow.
 */
export function swipeStep(dx: number, elapsedMs: number, width: number): -1 | 0 | 1 {
  const distance = Math.abs(dx);
  const far = width > 0 && distance >= width * COMMIT_RATIO;
  const flick = distance >= FLICK_MIN_PX && elapsedMs > 0 && distance / elapsedMs >= FLICK_SPEED;
  if (!far && !flick) return 0;
  return dx > 0 ? -1 : 1;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sheetOpen(): boolean {
  return document.querySelector('[role="dialog"]') != null;
}

type Track = { x: number; y: number; at: number; axis: SwipeAxis };

export function PeriodSwipe({
  period,
  onChange,
  children,
  className,
}: {
  period: PeriodChoice;
  onChange: (period: PeriodChoice) => void;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const steps = canStep(period);

  function settle() {
    const node = box.current;
    if (!node) return;
    node.classList.remove("ui-pswipe-drag");
    node.style.transform = "";
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    track.current = null;
    if (!steps || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (inEdgeZone(touch.clientX, window.innerWidth)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    if (sheetOpen()) return;
    track.current = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: null };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    if (event.touches.length !== 1) {
      track.current = null;
      settle();
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (start.axis == null) {
      start.axis = swipeAxis(dx, dy);
      if (start.axis === "y") {
        // Mostly vertical: the page scrolls, and this touch is done here.
        track.current = null;
        return;
      }
      if (start.axis == null) return;
    }
    if (reducedMotion()) return;
    const node = box.current;
    if (!node) return;
    const blocked = stepPeriod(period, dx > 0 ? -1 : 1) == null;
    node.classList.add("ui-pswipe-drag");
    node.style.transform = `translateX(${String(Math.round(dx * (blocked ? FOLLOW_BLOCKED : FOLLOW)))}px)`;
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    track.current = null;
    settle();
    if (start?.axis !== "x") return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const width = box.current?.getBoundingClientRect().width ?? 0;
    const step = swipeStep(touch.clientX - start.x, event.timeStamp - start.at, width);
    if (step === 0) return;
    const next = stepPeriod(period, step);
    if (next == null) return;
    onChange(next);
    // A short tick where the platform has one (Android); iOS Safari has none and ignores this.
    if (typeof navigator.vibrate === "function") navigator.vibrate(10);
  }

  return (
    <div
      ref={box}
      className={cx("ui-pswipe", steps && "ui-pswipe-on", className)}
      data-period-swipe={steps ? "" : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        track.current = null;
        settle();
      }}
    >
      {children}
    </div>
  );
}
