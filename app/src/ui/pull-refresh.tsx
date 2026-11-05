import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { isStandalone } from "./install-prompt";
import { inEdgeZone, lockAxis, type SwipeAxis } from "./period-swipe";
import { useToast } from "./toast";
import "./css/62-pull-refresh.css";

/**
 * FLOW-1039 and FLOW-1042 (DESIGN-RULES ld-07): pull to refresh, mounted once at the app root around
 * every routed screen. iOS gives a Home Screen web app no pull to refresh of its own, so a pull down
 * from the top of any screen does nothing there. The gesture rules follow FLOW-314, as the period,
 * card and edge swipes do:
 * - touch only, one finger, in the installed app (a browser tab keeps its own pull to refresh);
 * - the page is at scroll top 0, and the touch starts outside the edge zones (the edge-back swipe),
 *   a sheet or dialog, a field, a revealed swiped row, and any inner list scrolled down from its top;
 * - nothing is decided until the finger moved DECIDE_PX; a sideways move goes to the swipes, an
 *   upward one to the page scroll;
 * - the screen comes down at half the move, up to PULL_MAX_PX, over a gap in the colour of its top
 *   (the band's on Home and a project, the page's elsewhere), with the mark in the gap; a release at
 *   PULL_THRESHOLD_PX or more re-reads Flow's data from the server (every cached read goes stale,
 *   the ones on screen read again), and the screen rests there until they settle (PULL_MIN_MS at
 *   least). A pull starts no bank sync (the owner, 2026-11-05: "It should refresh the data from
 *   flow server.").
 */
export const PULL_THRESHOLD_PX = 64;
const PULL_RESIST = 0.5;
const PULL_MAX_PX = 96;
/** The spinner stays at least this long, so a quick refresh does not flash. */
const PULL_MIN_MS = 400;
/** A read that never settles ends the spinner here; it goes on in the background. */
export const PULL_CAP_MS = 15_000;
/** The collapse runs on --motion-sheet-out (220ms); the gap and the mark unmount after this. */
const CLOSE_FALLBACK_MS = 400;
export const PULL_FAILED = "הרענון נכשל. נסו שוב.";

/** How far the screen travels for a finger moved `dy` px down. */
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

/** The colour the gap above a pulled screen takes: its band's where it starts with one, else the page's. */
export type PullTone = "band" | "band-past" | "page";

export function pullTone(screen: Element | null): PullTone {
  const band = screen?.querySelector(".ui-band");
  // A band that is not drawn (display: none, here or above) has no boxes.
  if (band == null || band.getClientRects().length === 0 || band.getBoundingClientRect().top > 1) return "page";
  return band.classList.contains("ui-band-past") ? "band-past" : "band";
}

function atTop(): boolean {
  return window.scrollY <= 0 && (window.visualViewport?.scale ?? 1) <= 1.01;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Re-reads Flow's data from the server and resolves once the reads on screen settled and
 * PULL_MIN_MS passed, or at PULL_CAP_MS, so a hung read never keeps the pull busy: true unless a
 * read failed. Every cached read goes stale, so a read nested in another (`client.query` with its
 * own staleTime) and every other screen's reads read again too, not only the ones on screen. No
 * bank sync: a pull reads Flow's own server only.
 */
async function refreshAll(client: Pick<QueryClient, "invalidateQueries" | "getQueryCache">): Promise<boolean> {
  const started = Date.now();
  await Promise.race([Promise.all([client.invalidateQueries(), wait(PULL_MIN_MS)]), wait(PULL_CAP_MS)]);
  return !client.getQueryCache().findAll({ type: "active" }).some((query) => query.state.status === "error" && query.state.errorUpdatedAt >= started);
}

export type PullPhase = "idle" | "pulling" | "refreshing" | "closing";

type Track = { id: number; x: number; y: number; axis: SwipeAxis; active: boolean; travel: number };
type View = { phase: PullPhase; travel: number; tone: PullTone };

export function PullRefresh({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>({ phase: "idle", travel: 0, tone: "page" });
  const screen = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const busy = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let alive = true;
    let closeTimer = 0;
    let tone: PullTone = "page";
    function close() {
      setView({ phase: "closing", travel: 0, tone });
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        busy.current = false;
        if (alive) setView({ phase: "idle", travel: 0, tone });
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
        tone = pullTone(screen.current);
      }
      // From here the pull owns the touch, so the page does not scroll under it.
      if (event.cancelable) event.preventDefault();
      current.travel = pullTravel(dy);
      setView({ phase: "pulling", travel: current.travel, tone });
    }
    function onEnd() {
      const current = track.current;
      track.current = null;
      if (current?.active !== true) return;
      if (!pullArmed(current.travel)) {
        close();
        return;
      }
      setView({ phase: "refreshing", travel: PULL_THRESHOLD_PX, tone });
      void refreshAll(client).then((ok) => {
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

  return (
    <PullRefreshView phase={view.phase} travel={view.travel} tone={view.tone} screenRef={screen}>
      {children}
    </PullRefreshView>
  );
}

/**
 * Exported for the stories, which draw each phase. The pulled screen, the gap above it and the round mark in the gap, with the shared spinner. While
 * pulling the screen comes down with the finger and the spinner turns with the progress; armed, it
 * takes the accent; refreshing, the screen rests at the threshold and the spinner spins. The screen
 * moves by `top` on a relative box, not a transform, so the bars it pins (`position: fixed`: the
 * action bar, the card's step row, a save bar) keep the viewport and stay put. With reduced motion
 * the screen does not move: the mark fades in where it rests.
 */
export function PullRefreshView({
  phase,
  travel,
  tone = "page",
  screenRef,
  children,
}: {
  phase: PullPhase;
  travel: number;
  tone?: PullTone;
  screenRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const refreshing = phase === "refreshing";
  const idle = phase === "idle";
  const style = {
    "--pull-y": `${String(travel)}px`,
    "--pull-progress": String(Math.min(1, travel / PULL_THRESHOLD_PX)),
    "--pull-rest": `${String(PULL_THRESHOLD_PX)}px`,
    "--pull-max": `${String(PULL_MAX_PX)}px`,
  } as CSSProperties;
  return (
    <>
      {idle ? null : (
        <>
          <div className="ui-pull-gap" data-phase={phase} data-tone={tone} style={style} aria-hidden="true" />
          <div className="ui-pull-refresh" data-phase={phase} data-armed={pullArmed(travel) ? "" : undefined} style={style} aria-hidden="true">
            <span className="ui-spinner" />
          </div>
        </>
      )}
      <div ref={screenRef} className="ui-pull-screen" data-phase={idle ? undefined : phase} style={idle ? undefined : style}>
        {children}
      </div>
      <div role="status" className="sr-only">
        {refreshing ? "מרענן" : null}
      </div>
    </>
  );
}
