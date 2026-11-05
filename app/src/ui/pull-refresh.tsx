import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isStandalone } from "./install-prompt";
import { inEdgeZone, lockAxis, type SwipeAxis } from "./period-swipe";
import { useToast } from "./toast";
import "./css/62-pull-refresh.css";

/**
 * FLOW-1039 (DESIGN-RULES ld-07): pull to refresh, mounted once at the app root. iOS gives a Home
 * Screen web app no pull to refresh of its own, so a pull down from the top of any screen does
 * nothing there. The gesture rules follow FLOW-314, as the period, card and edge swipes do:
 * - touch only, one finger, in the installed app (a browser tab keeps its own pull to refresh);
 * - the page is at scroll top 0, and the touch starts outside the edge zones (the edge-back swipe),
 *   a sheet or dialog, a field, a revealed swiped row, and any inner list scrolled down from its top;
 * - nothing is decided until the finger moved DECIDE_PX; a sideways move goes to the swipes, an
 *   upward one to the page scroll;
 * - the mark follows at half the move, up to PULL_MAX_PX; a release at PULL_THRESHOLD_PX or more
 *   re-reads every query on screen, and the mark spins until the reads settle (PULL_MIN_MS at least).
 */
export const PULL_THRESHOLD_PX = 64;
const PULL_RESIST = 0.5;
const PULL_MAX_PX = 96;
/** The spinner stays at least this long, so a quick refresh does not flash. */
export const PULL_MIN_MS = 400;
/** The collapse runs on --motion-sheet-out (220ms); the mark unmounts after this. */
const CLOSE_FALLBACK_MS = 400;
export const PULL_FAILED = "הרענון נכשל. נסו שוב.";

/** How far the mark travels for a finger moved `dy` px down. */
export function pullTravel(dy: number): number {
  return dy <= 0 ? 0 : Math.min(dy * PULL_RESIST, PULL_MAX_PX);
}

/** True when a release at this travel refreshes. */
export function pullArmed(travel: number): boolean {
  return travel >= PULL_THRESHOLD_PX;
}

/** The installed app only. Tests and stories opt in with `data-pull-refresh="on"` on <html>. */
function pullAvailable(): boolean {
  return document.documentElement.dataset.pullRefresh === "on" || isStandalone();
}

function scrolledDown(node: Element): boolean {
  if (!(node instanceof HTMLElement) || node.scrollTop <= 0) return false;
  const overflow = getComputedStyle(node).overflowY;
  return overflow === "auto" || overflow === "scroll";
}

/** A touch that starts here never pulls: a sheet is open, or the target keeps the touch itself. */
export function pullBlocked(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]') != null) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], .ui-swipe-row[data-open], .ui-swipe-row [data-drag], .ui-toast') != null) return true;
  for (let node: Element | null = target; node != null && node !== document.body; node = node.parentElement) {
    if (scrolledDown(node)) return true;
  }
  return false;
}

function atTop(): boolean {
  return window.scrollY <= 0 && (window.visualViewport?.scale ?? 1) <= 1.01;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Re-reads every active query and resolves once they settled and `minMs` passed: true when every
 * read succeeded. The app starts no bank sync on open (the server syncs on its own schedule), so a
 * pull starts none either.
 */
export async function refreshActive(client: Pick<QueryClient, "refetchQueries" | "getQueryCache">, minMs = PULL_MIN_MS): Promise<boolean> {
  const started = Date.now();
  await Promise.all([client.refetchQueries({ type: "active" }), wait(minMs)]);
  return !client.getQueryCache().findAll({ type: "active" }).some((query) => query.state.status === "error" && query.state.errorUpdatedAt >= started);
}

export type PullPhase = "idle" | "pulling" | "refreshing" | "closing";

type Track = { id: number; x: number; y: number; axis: SwipeAxis; active: boolean; travel: number };

export function PullRefresh() {
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<{ phase: PullPhase; travel: number }>({ phase: "idle", travel: 0 });
  const track = useRef<Track | null>(null);
  const busy = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let alive = true;
    let closeTimer = 0;
    function close() {
      setView({ phase: "closing", travel: 0 });
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        busy.current = false;
        if (alive) setView({ phase: "idle", travel: 0 });
      }, CLOSE_FALLBACK_MS);
    }
    function drop() {
      const current = track.current;
      track.current = null;
      if (current?.active === true) close();
    }
    function onStart(event: TouchEvent) {
      if (track.current != null) drop();
      if (busy.current || event.touches.length !== 1 || !pullAvailable() || !atTop()) return;
      const touch = event.touches[0];
      if (touch == null || inEdgeZone(touch.clientX, window.innerWidth) || pullBlocked(event.target)) return;
      track.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null, active: false, travel: 0 };
    }
    function onMove(event: TouchEvent) {
      const current = track.current;
      if (current == null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === current.id);
      if (touch == null || event.touches.length !== 1) {
        drop();
        return;
      }
      const dy = touch.clientY - current.y;
      if (!current.active) {
        const axis = lockAxis(current, touch.clientX - current.x, dy);
        if (axis == null) return;
        // Sideways goes to the row, period and card swipes; upward to the page scroll.
        if (axis === "x" || dy <= 0 || !atTop()) {
          track.current = null;
          return;
        }
        current.active = true;
        busy.current = true;
      }
      // From here the pull owns the touch, so the page does not scroll under it.
      if (event.cancelable) event.preventDefault();
      current.travel = pullTravel(dy);
      setView({ phase: "pulling", travel: current.travel });
    }
    function onEnd() {
      const current = track.current;
      track.current = null;
      if (current?.active !== true) return;
      if (!pullArmed(current.travel)) {
        close();
        return;
      }
      setView({ phase: "refreshing", travel: PULL_THRESHOLD_PX });
      void refreshActive(client).then((ok) => {
        if (!alive) return;
        if (!ok) toastRef.current.show({ tone: "bad", message: PULL_FAILED });
        close();
      });
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", drop);
    return () => {
      alive = false;
      window.clearTimeout(closeTimer);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", drop);
    };
  }, [client]);

  return <PullRefreshMark phase={view.phase} travel={view.travel} />;
}

/**
 * The round mark under the top safe area, with the shared spinner. While pulling it comes down
 * with the finger and turns with the progress; armed, the spinner takes the accent; refreshing,
 * it spins in place. With reduced motion it does not move: it fades in where it rests.
 */
export function PullRefreshMark({ phase, travel }: { phase: PullPhase; travel: number }) {
  const refreshing = phase === "refreshing";
  const progress = Math.min(1, travel / PULL_THRESHOLD_PX);
  const style = {
    "--pull-y": `${String(travel)}px`,
    "--pull-progress": String(progress),
    "--pull-rest": `${String(PULL_THRESHOLD_PX)}px`,
  } as CSSProperties;
  return (
    <>
      <div role="status" className="sr-only">
        {refreshing ? "מרענן" : null}
      </div>
      {phase === "idle" ? null : (
        <div
          className="ui-pull-refresh"
          data-phase={phase}
          data-armed={pullArmed(travel) ? "" : undefined}
          style={style}
          aria-hidden="true"
        >
          <span className="ui-spinner" />
        </div>
      )}
    </>
  );
}
