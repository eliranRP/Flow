import { useEffect, useRef, useState, type ReactNode, type Ref, type TouchEvent } from "react";
import { cx } from "./cx";
import { blocksEdgeBack, EDGE_PX } from "./edge-back";
import { swipeAxis, swipeStep } from "./period-swipe";

/**
 * FLOW-314: a sideways swipe on the card does what הבאה and הקודמת do. The finger moving right opens the
 * next card, which enters from the left like a screen push; moving left opens the previous one.
 * The rules are the ones the band figure's swipe shares (period-swipe.tsx):
 * - touch only, one finger;
 * - a start within 24px of either screen edge is left to the edge swipe-back, the 24th px
 *   included, as swipe-back takes it;
 * - a start inside a field, a sheet or a sideways list, or while a sheet is open, is left alone;
 * - nothing is decided until the finger moved 10px; a mostly vertical move goes to the page scroll;
 * - the card follows the finger and commits past 30% of its width, or on a flick;
 * - FLOW-345: mid-drag the neighbour's edge peeks in from the side it will enter (`peekNext`, `peekPrev`);
 * - FLOW-345: toward a list end the card gives a little (a quarter of the move, at most 32px) and springs back;
 * - with reduced motion the card stays put, nothing peeks, and it swaps on release;
 * - while the page is pinch-zoomed the card does not swipe, so a sideways pan moves the zoomed view.
 */
export type CardStep = "next" | "prev";

type Track = { x: number; y: number; at: number; axis: "x" | "y" | null };

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Swipe-back starts at 24px or closer to the start edge, so the card leaves that px to it too. */
export function nearScreenEdge(x: number, viewportWidth: number): boolean {
  return x <= EDGE_PX || x >= viewportWidth - EDGE_PX;
}

function zoomedIn(): boolean {
  const scale = window.visualViewport?.scale ?? 1;
  return scale > 1.01;
}

/** Pinch-zoom is on: the card gives up `touch-action: pan-y` so the zoomed view pans sideways. */
function useZoomedIn(): boolean {
  const [zoomed, setZoomed] = useState(zoomedIn);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    function onResize() {
      setZoomed(zoomedIn());
    }
    viewport.addEventListener("resize", onResize);
    return () => {
      viewport.removeEventListener("resize", onResize);
    };
  }, []);
  return zoomed;
}

/** FLOW-345: how far the card gives toward a list end: a quarter of the move, at most 32px. */
export const END_GIVE_PX = 32;

export function endGive(dx: number): number {
  const give = Math.min(Math.abs(dx) / 4, END_GIVE_PX);
  return dx < 0 ? -give : give;
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
  peekNext = null,
  peekPrev = null,
  children,
}: {
  canNext: boolean;
  canPrev: boolean;
  onStep: (step: CardStep) => void;
  /** How this card was reached by a swipe: it slides in from that side. */
  enter?: CardStep | null;
  /** FLOW-345: the neighbour's name on the edge a drag pulls in; with none the edge is a plain card. */
  peekNext?: string | null;
  peekPrev?: string | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const nextEdge = useRef<HTMLDivElement>(null);
  const prevEdge = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const zoomed = useZoomedIn();
  const on = (canNext || canPrev) && !zoomed;

  function settle() {
    for (const node of [box.current, nextEdge.current, prevEdge.current]) {
      if (!node) continue;
      node.classList.remove("ui-cswipe-drag");
      node.style.transform = "";
    }
  }

  /** Moves the card, and the neighbour on the side the finger opens, by the same amount. */
  function drag(shift: number, edge: HTMLDivElement | null) {
    const other = edge === nextEdge.current ? prevEdge.current : nextEdge.current;
    if (other) {
      other.classList.remove("ui-cswipe-drag");
      other.style.transform = "";
    }
    for (const node of [box.current, edge]) {
      if (!node) continue;
      node.classList.add("ui-cswipe-drag");
      node.style.transform = `translateX(${String(Math.round(shift))}px)`;
    }
  }

  function open(step: CardStep): boolean {
    return step === "next" ? canNext : canPrev;
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    // A second finger ends a swipe in progress, and the card goes back in place.
    if (track.current != null) settle();
    track.current = null;
    if (!on || event.touches.length !== 1 || zoomedIn()) return;
    const touch = event.touches[0];
    if (!touch || nearScreenEdge(touch.clientX, window.innerWidth)) return;
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
    if (!box.current || reducedMotion()) return;
    const side = dx > 0 ? "next" : "prev";
    // Toward a side with no card the card only gives a little, and nothing peeks in.
    if (!open(side)) {
      drag(endGive(dx), null);
      return;
    }
    drag(dx, side === "next" ? nextEdge.current : prevEdge.current);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    track.current = null;
    settle();
    // A finger still down (one that landed outside the card too) makes this no swipe.
    if (start?.axis !== "x" || event.touches.length > 0) return;
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
      {/* The neighbours wait just outside the frame, which clips them; a drag pulls one in. */}
      {canNext ? <PeekEdge ref={nextEdge} side="next" name={peekNext} /> : null}
      {canPrev ? <PeekEdge ref={prevEdge} side="prev" name={peekPrev} /> : null}
      <div ref={box} className="ui-cswipe-card" data-enter={enter ?? undefined}>
        {children}
      </div>
    </div>
  );
}

/** A lightweight stand-in for the neighbour: a card-coloured panel, with its name when the cache has it. */
function PeekEdge({ ref, side, name }: { ref: Ref<HTMLDivElement>; side: CardStep; name: string | null }) {
  return (
    <div ref={ref} className="ui-cswipe-peek" data-side={side} aria-hidden="true">
      {name ? <p className="t-title-3 ui-cswipe-peek-name" data-clip-ok="">{name}</p> : null}
    </div>
  );
}
