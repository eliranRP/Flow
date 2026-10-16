import { useEffect, useRef, useState, type AnimationEvent, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { blocksEdgeBack } from "./edge-back";
import { inEdgeZone, lockAxis, reducedMotion, swipeStep } from "./period-swipe";

/**
 * FLOW-325 (plan §10): a row swiped toward the start side (right, in RTL) is removed, as on an
 * iOS list. The row's own ✕ stays, for a keyboard, a screen reader and a mouse; the swipe is a
 * shortcut to the same action. The rules are FLOW-314's (card-swipe.tsx, period-swipe.tsx):
 * - touch only, one finger;
 * - a start within 24px of either screen edge is left to the edge swipe-back;
 * - a start inside a field, a sheet or a sideways list, or while a sheet is open, is left alone;
 * - nothing is decided until the finger moved 10px; a mostly vertical move goes to the page scroll;
 * - the row follows the finger over a neutral "הסרה" and is removed past 30% of its width, or on a
 *   flick; short of that it settles back. Toward the end side it only gives a little;
 * - with reduced motion the row stays put and is removed on release;
 * - while the page is pinch-zoomed the row does not swipe.
 *
 * FLOW-363 (3c): with `reveal`, a move toward the start past 30px opens the row over an action
 * (`--swipe-action` wide). A move back, or a tap on the row, closes it; a tap on the action runs it.
 */

type Track = { x: number; y: number; at: number; axis: "x" | "y" | null };

/** A click this soon after a drag is the drag's own, not a tap. */
const CLICK_AFTER_DRAG_MS = 400;

/** How far the row gives toward the end side: a quarter of the move, at most 32px. */
const END_GIVE_PX = 32;

/** The move, in px, that opens or closes a revealed row. Matches --swipe-action (app.css). */
const OPEN_PX = 120;

/** The row leaves after its slide, or on this fallback when animationend does not come. */
const LEAVE_MS = 240;

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

/** FLOW-913: how far the one-time peek slides the row toward the start side. */
const PEEK_PX = 72;

export type SwipeRowReveal = {
  /** The action's name, read aloud and shown on it, e.g. "התעלמות מההתראה". */
  label: string;
  onAct: () => void;
};

export function SwipeRow({
  onRemove,
  disabled = false,
  label = "הסרה",
  peek = false,
  reveal,
  children,
}: {
  onRemove: () => void;
  /** The word under the row: "הסרה", or "סגירה" for an alert closed for this user (FLOW-415, FLOW-913). */
  label?: string;
  /** FLOW-913: on mount the row slides a little toward the start and back once, showing the word under it. */
  peek?: boolean;
  /** While the editor is busy or locked, the row stays put. */
  disabled?: boolean;
  /** FLOW-363 (3c): the row opens over an action instead of removing itself. */
  reveal?: SwipeRowReveal;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  // A drag can end in a click on whatever the finger started on; that click is not a tap. Only a
  // click right after the drag is dropped, so a later keyboard or mouse press always goes through.
  const dragEnd = useRef<number | null>(null);
  const leaving = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  // The removal lands a moment after the release; a save that started meanwhile keeps the part.
  const off = useRef(disabled);
  off.current = disabled;

  useEffect(() => () => {
    if (leaving.current != null) window.clearTimeout(leaving.current);
  }, []);

  useEffect(() => {
    const box = frame.current;
    if (!peek || !box || reducedMotion()) return;
    box.style.setProperty("--swipe-row-peek", `${String(rtl() ? PEEK_PX : -PEEK_PX)}px`);
    box.setAttribute("data-peek", "");
    const done = () => { box.removeAttribute("data-peek"); };
    box.addEventListener("animationend", done, { once: true });
    return () => {
      box.removeEventListener("animationend", done);
      done();
    };
  }, [peek]);

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

  /** Where a revealed row rests, in px along the screen (right in RTL). */
  function openShift(): number {
    return rtl() ? OPEN_PX : -OPEN_PX;
  }

  function setOpenState(next: boolean) {
    openRef.current = next;
    setOpen(next);
    if (next) frame.current?.setAttribute("data-open", "");
    else frame.current?.removeAttribute("data-open");
  }

  function finishLeave() {
    if (leaving.current == null) return;
    window.clearTimeout(leaving.current);
    leaving.current = null;
    if (off.current) {
      frame.current?.removeAttribute("data-leaving");
      frame.current?.classList.remove("m-row-leave");
      place(null);
      return;
    }
    onRemove();
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (track.current != null) place(null);
    track.current = null;
    dragEnd.current = null;
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
    const axis = lockAxis(start, dx, touch.clientY - start.y);
    if (axis === "y") {
      track.current = null;
      return;
    }
    if (axis == null) return;
    if (reducedMotion()) return;
    // A revealed row starts from where it rests.
    const raw = (reveal != null && openRef.current ? openShift() : 0) + dx;
    // Toward the end side there is nothing to reveal: the row only gives a little.
    const give = Math.min(Math.abs(raw) / 4, END_GIVE_PX);
    place(towardStart(raw, rtl()) > 0 ? raw : raw < 0 ? -give : give);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = track.current;
    track.current = null;
    if (start?.axis === "x") dragEnd.current = Date.now();
    if (start?.axis !== "x" || event.touches.length > 0) {
      place(null);
      return;
    }
    const touch = event.changedTouches[0];
    const width = frame.current?.getBoundingClientRect().width ?? 0;
    const dx = touch ? touch.clientX - start.x : 0;
    if (reveal != null) {
      const move = towardStart(dx, rtl());
      place(null);
      if (!openRef.current && move > OPEN_PX / 4) setOpenState(true);
      else if (openRef.current && move < -OPEN_PX / 4) setOpenState(false);
      return;
    }
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
    frame.current?.classList.add("m-row-leave");
    place(dx > 0 ? width : -width);
    leaving.current = window.setTimeout(finishLeave, LEAVE_MS);
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const ended = dragEnd.current;
    dragEnd.current = null;
    if (ended != null && Date.now() - ended <= CLICK_AFTER_DRAG_MS) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // A tap on the row, or on what it holds, closes a revealed row and does nothing else.
    const target = event.target;
    if (reveal != null && openRef.current && target instanceof Element && !target.closest(".ui-swipe-row-action")) {
      event.preventDefault();
      event.stopPropagation();
      setOpenState(false);
    }
  }

  return (
    <div
      ref={frame}
      className="ui-swipe-row"
      data-on={disabled ? undefined : ""}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        track.current = null;
        place(null);
      }}
      onClickCapture={onClickCapture}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && event.animationName === "m-row-leave") finishLeave();
      }}
    >
      {reveal != null ? (
        <div className="ui-swipe-row-under">
          <button
            type="button"
            className="ui-swipe-row-action"
            aria-label={reveal.label}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setOpenState(false);
              reveal.onAct();
            }}
          >
            {reveal.label}
          </button>
        </div>
      ) : (
        /* Under the row, shown only while it moves; the row's ✕ is the named control. */
        <div className="ui-swipe-row-under" aria-hidden="true">
          <span>{label}</span>
        </div>
      )}
      <div ref={row} className="ui-swipe-row-body">
        {children}
      </div>
    </div>
  );
}
