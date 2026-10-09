import { useRef, type ReactNode, type TouchEvent } from "react";
import { cx } from "./cx";
import { blocksEdgeBack } from "./edge-back";
import { inEdgeZone, swipeAxis, swipeStep } from "./period-swipe";

/**
 * FLOW-314: a sideways swipe on the card does what ˄ ˅ do. The finger moving right opens the
 * next card, which enters from the left like a screen push; moving left opens the previous one.
 * The rules are the ones the band figure's swipe shares (period-swipe.tsx):
 * - touch only, one finger;
 * - a start within 24px of either screen edge is left to the edge swipe-back;
 * - a start inside a field, a sheet or a sideways list, or while a sheet is open, is left alone;
 * - nothing is decided until the finger moved 10px; a mostly vertical move goes to the page scroll;
 * - the card follows the finger and commits past 30% of its width, or on a flick;
 * - at a list end the card does not move;
 * - with reduced motion the card stays put and swaps on release.
 */
export type CardStep = "next" | "prev";

type Track = { x: number; y: number; at: number; axis: "x" | "y" | null };

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The step a horizontal move asks for: right is next, left is previous. */
export function cardStep(dx: number, elapsedMs: number, width: number): CardStep | null {
  const step = swipeStep(dx, elapsedMs, width);
  if (step === 0) return null;
  return step === -1 ? "next" : "prev";
}

export function CardSwipe({
  canNext,
  canPrev,
  onStep,
  enter = null,
  children,
}: {
  canNext: boolean;
  canPrev: boolean;
  onStep: (step: CardStep) => void;
  /** How this card was reached by a swipe: it slides in from that side. */
  enter?: CardStep | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const on = canNext || canPrev;

  function settle() {
    const node = box.current;
    if (!node) return;
    node.classList.remove("ui-cswipe-drag");
    node.style.transform = "";
  }

  function open(step: CardStep): boolean {
    return step === "next" ? canNext : canPrev;
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    track.current = null;
    if (!on || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch || inEdgeZone(touch.clientX, window.innerWidth)) return;
    if (blocksEdgeBack(event.target)) return;
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
    if (start.axis == null) {
      start.axis = swipeAxis(dx, touch.clientY - start.y);
      if (start.axis === "y") {
        track.current = null;
        return;
      }
      if (start.axis == null) return;
    }
    const node = box.current;
    if (!node || reducedMotion()) return;
    // No movement toward a side with no card.
    const shift = open(dx > 0 ? "next" : "prev") ? dx : 0;
    node.classList.add("ui-cswipe-drag");
    node.style.transform = `translateX(${String(Math.round(shift))}px)`;
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    track.current = null;
    settle();
    if (start?.axis !== "x") return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const width = box.current?.getBoundingClientRect().width ?? 0;
    const step = cardStep(touch.clientX - start.x, event.timeStamp - start.at, width);
    if (step == null || !open(step)) return;
    onStep(step);
    if (typeof navigator.vibrate === "function") navigator.vibrate(10);
  }

  // The frame clips the card while it follows the finger, so the page never grows a sideways scroll.
  return (
    <div
      className={cx("ui-cswipe", on && "ui-cswipe-on")}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        track.current = null;
        settle();
      }}
    >
      <div ref={box} className="ui-cswipe-card" data-enter={enter ?? undefined}>
        {children}
      </div>
    </div>
  );
}
