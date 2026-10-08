import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BackIcon } from "./icons";
import { isStandalone } from "./install-prompt";

/**
 * FLOW-332: a swipe from the start (right) edge goes back on a pushed screen, like the iOS
 * gesture the installed app does not get. The screen's own Back button registers what back
 * means there, so the swipe and the button always agree. The gesture rules follow FLOW-314.
 */

/** A start within this many px of the start edge begins a swipe. */
export const EDGE_PX = 24;
/** Direction is decided after this much movement. */
const DECIDE_PX = 10;
/** Past this share of the width, or a flick, the release goes back. */
const COMMIT_SHARE = 0.3;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 40;

type Entry = { go: () => void; enabled: boolean };
const handlers: Entry[] = [];

/**
 * Each Back keeps its place from when it mounted, so the front-most screen's Back wins even
 * after an older one is disabled and enabled again. A disabled Back is skipped, not removed.
 */
export function useEdgeBack(go: (() => void) | null): void {
  const goRef = useRef(go);
  goRef.current = go;
  const entry = useRef<Entry | null>(null);
  useEffect(() => {
    const mine: Entry = { go: () => { goRef.current?.(); }, enabled: goRef.current != null };
    entry.current = mine;
    handlers.push(mine);
    return () => {
      const index = handlers.indexOf(mine);
      if (index !== -1) handlers.splice(index, 1);
    };
  }, []);
  const enabled = go != null;
  useEffect(() => {
    if (entry.current) entry.current.enabled = enabled;
  }, [enabled]);
}

/** The front-most Back, or null when it is disabled or there is none (a tab root). */
export function edgeBackHandler(): (() => void) | null {
  const top = handlers[handlers.length - 1];
  return top?.enabled === true ? top.go : null;
}

/**
 * The installed app only: a browser tab keeps its own edge gestures (Safari's forward swipe
 * starts at the right edge). Tests and stories opt in with `data-edge-back="on"` on <html>.
 */
export function edgeBackAvailable(): boolean {
  return document.documentElement.dataset.edgeBack === "on" || isStandalone();
}

function rtl(): boolean {
  return document.documentElement.dir !== "ltr";
}

/** Distance from the start edge: the right edge in RTL. */
function fromStart(x: number): number {
  return rtl() ? window.innerWidth - x : x;
}

/** Movement toward the end side is positive. */
function towardEnd(dx: number): number {
  return rtl() ? -dx : dx;
}

function scrollsSideways(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.scrollWidth <= node.clientWidth + 1) return false;
  const overflow = getComputedStyle(node).overflowX;
  return overflow === "auto" || overflow === "scroll";
}

/** A sheet, a field, or a sideways list keeps the touch. */
export function blocksEdgeBack(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]') != null) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-edge-back]") != null) return true;
  for (let node: Element | null = target; node != null && node !== document.body; node = node.parentElement) {
    if (scrollsSideways(node)) return true;
  }
  return false;
}

type Track = { id: number; x: number; y: number; t: number; dx: number; decided: boolean; armed: boolean };

/** Mounted once at the app root. Shows a small back mark that follows the finger. */
export function EdgeSwipeBack() {
  const [pull, setPull] = useState<{ dx: number; y: number } | null>(null);
  const track = useRef<Track | null>(null);

  useEffect(() => {
    function reset() {
      track.current = null;
      setPull(null);
    }
    function onStart(event: TouchEvent) {
      // A second finger ends a swipe in progress, and takes the mark with it.
      if (track.current != null) reset();
      if (event.touches.length !== 1 || !edgeBackAvailable()) return;
      const touch = event.touches[0];
      if (touch == null || fromStart(touch.clientX) > EDGE_PX) return;
      if (edgeBackHandler() == null || blocksEdgeBack(event.target)) return;
      track.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, t: event.timeStamp, dx: 0, decided: false, armed: false };
    }
    function onMove(event: TouchEvent) {
      const current = track.current;
      if (current == null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === current.id);
      if (touch == null) return;
      const dx = towardEnd(touch.clientX - current.x);
      const dy = touch.clientY - current.y;
      if (!current.decided) {
        if (Math.hypot(dx, dy) < DECIDE_PX) return;
        // Mostly vertical, or back toward the edge: the page keeps the touch.
        if (Math.abs(dy) > Math.abs(dx) || dx <= 0) {
          reset();
          return;
        }
        current.decided = true;
      }
      // iOS hands a touch to native scroll once a move is not prevented; this one is, from here on.
      if (event.cancelable) event.preventDefault();
      current.dx = Math.max(0, dx);
      const armed = current.dx >= window.innerWidth * COMMIT_SHARE;
      // A short tick where letting go starts to go back, where the device supports it.
      if (armed && !current.armed && "vibrate" in navigator) navigator.vibrate(10);
      current.armed = armed;
      // The mark keeps the height where the touch started.
      setPull({ dx: current.dx, y: current.y });
    }
    function onEnd(event: TouchEvent) {
      const current = track.current;
      if (current == null) return;
      reset();
      if (!current.decided) return;
      // Velocity is measured from the start, so a short quick swipe still counts as a flick.
      const elapsed = Math.max(1, event.timeStamp - current.t);
      const flick = current.dx >= FLICK_MIN_PX && current.dx / elapsed >= FLICK_PX_PER_MS;
      if (current.dx >= window.innerWidth * COMMIT_SHARE || flick) edgeBackHandler()?.();
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);

  if (pull == null) return null;
  return <EdgeBackMark pull={pull.dx} y={pull.y} armed={pull.dx >= window.innerWidth * COMMIT_SHARE} />;
}

/**
 * The round back mark at the start edge, at the height of the touch. It starts almost hidden
 * and slides in at half the pull, up to 52px.
 */
export function EdgeBackMark({ pull, y, armed }: { pull: number; y: number; armed: boolean }) {
  const shift = Math.min(pull, 104) / 2;
  const style = {
    "--edge-back-x": `${String(rtl() ? -shift : shift)}px`,
    "--edge-back-y": `${String(y)}px`,
  } as CSSProperties;
  return (
    <div className={armed ? "ui-edge-back ui-edge-back-armed" : "ui-edge-back"} style={style} aria-hidden="true">
      <BackIcon size={20} />
    </div>
  );
}
