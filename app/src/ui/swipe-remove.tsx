import { useEffect, useRef, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { blocksEdgeBack } from "./edge-back";
import { inEdgeZone, swipeAxis, swipeStep } from "./period-swipe";
import { TrashIcon } from "./icons";

/**
 * FLOW-325 (plan §10): a row swiped toward the start side (right, in RTL) is removed, as on an
 * iOS list. The row's own ✕ stays, for a keyboard, a screen reader and a mouse; the swipe is a
 * shortcut to the same action. The rules are FLOW-314's (card-swipe.tsx, period-swipe.tsx):
 * - touch only, one finger;
 * - a start within 24px of either screen edge is left to the edge swipe-back;
 * - a start inside a field, a sheet or a sideways list, or while a sheet is open, is left alone;
 * - nothing is decided until the finger moved 10px; a mostly vertical move goes to the page scroll;
 * - the row follows the finger over a red "מחיקה" and is removed past 30% of its width, or on a
 *   flick; short of that it settles back. Toward the end side it only gives a little;
 * - with reduced motion the row stays put and is removed on release;
 * - while the page is pinch-zoomed the row does not swipe.
 */

type Track = { x: number; y: number; at: number; axis: "x" | "y" | null };

/** How far the row gives toward the end side: a quarter of the move, at most 32px. */
const END_GIVE_PX = 32;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rtl(): boolean {
  return document.documentElement.dir !== "ltr";
}

/** Movement toward the start side (right, in RTL) is positive. */
export function towardStart(dx: number, isRtl: boolean): number {
  return isRtl ? dx : -dx;
}

/** True when a finished move removes the row: toward the start side, far enough or fast enough. */
export function swipeRemoves(dx: number, elapsedMs: number, width: number, isRtl: boolean): boolean {
  const move = towardStart(dx, isRtl);
  return move > 0 && swipeStep(move, elapsedMs, width) === -1;
}

export function SwipeRemove({
  onRemove,
  disabled = false,
  children,
}: {
  onRemove: () => void;
  /** While the editor is busy or locked, the row stays put. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  // A drag can end in a click on whatever the finger started on; that click is not a tap. The
  // next touch clears the mark, so a drag that ended with no click never eats a later tap.
  const dragged = useRef(false);
  const leaving = useRef<number | null>(null);

  useEffect(() => () => {
    if (leaving.current != null) window.clearTimeout(leaving.current);
  }, []);

  function place(shift: number | null) {
    const node = row.current;
    const box = frame.current;
    if (!node || !box) return;
    if (shift == null) {
      node.style.transform = "";
      box.removeAttribute("data-drag");
      return;
    }
    box.setAttribute("data-drag", "");
    node.style.transform = `translateX(${String(Math.round(shift))}px)`;
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (track.current != null) place(null);
    track.current = null;
    dragged.current = false;
    if (disabled || leaving.current != null || event.touches.length !== 1) return;
    if ((window.visualViewport?.scale ?? 1) > 1.01) return;
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
      place(null);
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
      dragged.current = true;
    }
    if (reducedMotion()) return;
    // Toward the end side there is nothing to reveal: the row only gives a little.
    const give = Math.min(Math.abs(dx) / 4, END_GIVE_PX);
    place(towardStart(dx, rtl()) > 0 ? dx : dx < 0 ? -give : give);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    track.current = null;
    if (start?.axis !== "x" || event.touches.length > 0) {
      place(null);
      return;
    }
    const touch = event.changedTouches[0];
    const width = frame.current?.getBoundingClientRect().width ?? 0;
    const dx = touch ? touch.clientX - start.x : 0;
    if (!swipeRemoves(dx, event.timeStamp - start.at, width, rtl())) {
      place(null);
      return;
    }
    if (typeof navigator.vibrate === "function") navigator.vibrate(10);
    if (reducedMotion()) {
      place(null);
      onRemove();
      return;
    }
    // The row slides the rest of the way out, then goes.
    frame.current?.setAttribute("data-leaving", "");
    place(dx > 0 ? width : -width);
    leaving.current = window.setTimeout(() => {
      leaving.current = null;
      onRemove();
    }, 150);
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={frame}
      className="ui-sremove"
      data-on={disabled ? undefined : ""}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        track.current = null;
        place(null);
      }}
      onClickCapture={onClickCapture}
    >
      {/* Under the row, shown only while it moves; the row's ✕ is the named control. */}
      <div className="ui-sremove-under" aria-hidden="true">
        <TrashIcon size={20} />
        <span>מחיקה</span>
      </div>
      <div ref={row} className="ui-sremove-row">
        {children}
      </div>
    </div>
  );
}
