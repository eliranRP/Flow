import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { isStandalone } from "./install-prompt";
import { inEdgeZone, lockAxis, type SwipeAxis } from "./period-swipe";
import { useToast } from "./toast";
import "./css/62-pull-refresh.css";

/**
 * FLOW-1039, FLOW-1042 and FLOW-1050 (DESIGN-RULES ld-07): pull to refresh, mounted once at the app
 * root around every routed screen. iOS gives a Home Screen web app no pull to refresh of its own, so
 * a pull down from the top of any screen does nothing there. The gesture rules follow FLOW-314, as
 * the period, card and edge swipes do:
 * - touch only, one finger, in the installed app (a browser tab keeps its own pull to refresh);
 * - the page is at scroll top 0, and the touch starts outside the edge zones (the edge-back swipe),
 *   a sheet or dialog, a field, a revealed swiped row, and any inner list scrolled down from its top;
 * - nothing is decided until the finger moved DECIDE_PX; a sideways move goes to the swipes, an
 *   upward one to the page scroll;
 * - the screen comes down with the finger on a rubber band (`pullTravel`: 1:1 at first, then with
 *   growing resistance, no hard stop), over a gap in the colour of its top (the band's on Home and a
 *   project, the page's elsewhere), with the iOS activity indicator in the gap: its 12 spokes appear
 *   one by one with the pull, all 12 at PULL_THRESHOLD_PX, where a light haptic tick plays once;
 * - a release there re-reads Flow's data from the server (every cached read goes stale, the ones on
 *   screen read again): the screen eases up to PULL_REST_PX and holds while the spinner turns, until
 *   the reads settle (PULL_MIN_MS at least); then the spinner fades and shrinks and the screen glides
 *   back. A release before the threshold glides back the same way. A touch during that return
 *   catches the screen where it is and pulls on from there. A pull starts no bank sync (the owner,
 *   2026-11-05: "It should refresh the data from flow server.").
 */
export const PULL_THRESHOLD_PX = 64;
/**
 * The rubber band: `travel = b·move + (1 - b)·H·move / (H + move)`, half straight and half a knee.
 * Its slope is 1 at the start (b + (1 - b)) and falls toward b = 0.5, with no cap. The threshold
 * comes at 110px of move after the 10px decision (120px from touch-down), and 290px of move gives
 * 155px. The reference reaches about 170px there, but it runs close to straight (slope about 0.57)
 * from the start: a curve that slows down and starts 1:1 cannot pass both 64px at 110 and 170px at
 * 290 (that would need travel(290) / travel(110) above 290 / 110), so this one keeps the 1:1 start.
 */
const PULL_LINEAR = 0.5;
const PULL_KNEE_PX = 21.5;
/** Where the screen rests while refreshing: the 28px spinner with 18px above and below it. */
export const PULL_REST_PX = 64;
/** The spinner's spokes. */
export const PULL_SPOKES = 12;
/** The spinner stays at least this long, so a quick refresh does not flash. */
const PULL_MIN_MS = 400;
/** A read that never settles ends the spinner here; it goes on in the background. */
export const PULL_CAP_MS = 15_000;
/** The return runs on --motion-pull-return (400ms); the gap and the spinner unmount after this. */
const CLOSE_FALLBACK_MS = 500;
export const PULL_FAILED = "הרענון נכשל. נסו שוב.";

/** How far the screen travels for a finger moved `move` px down: the rubber band. */
export function pullTravel(move: number): number {
  if (move <= 0) return 0;
  return PULL_LINEAR * move + ((1 - PULL_LINEAR) * PULL_KNEE_PX * move) / (PULL_KNEE_PX + move);
}

/** The finger move that brings the screen `travel` px down: `pullTravel`'s inverse (a quadratic's root). */
export function pullMove(travel: number): number {
  if (travel <= 0) return 0;
  const knee = PULL_KNEE_PX;
  return (travel - knee + Math.sqrt((knee - travel) ** 2 + 4 * PULL_LINEAR * travel * knee)) / (2 * PULL_LINEAR);
}

/** How many spokes show at this travel: none at the start, all 12 at the threshold. */
export function pullSpokes(travel: number): number {
  return Math.round(Math.min(1, Math.max(0, travel / PULL_THRESHOLD_PX)) * PULL_SPOKES);
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

/**
 * The phases: `returning` is the glide back after a refresh (the spinner turns as it fades),
 * `closing` the glide back from a release before the threshold (the spokes fade where they stood).
 */
export type PullPhase = "idle" | "pulling" | "refreshing" | "returning" | "closing";

/** The move counts from `y`; `from` is the move the screen already had there (a caught return). */
type Track = { id: number; x: number; y: number; axis: SwipeAxis; active: boolean; from: number; travel: number; ticked: boolean };
type View = { phase: PullPhase; travel: number; tone: PullTone };

function px(value: string): number {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Where a returning screen is right now, as a pull's travel: read from the running transition (the
 * screen's live `top`), less the share of the safe area that rides on it (`--pull-travel` in the CSS).
 */
function liveTravel(screenBox: HTMLElement | null): number {
  if (screenBox == null) return 0;
  const top = px(getComputedStyle(screenBox).top);
  if (top <= 0) return 0;
  const mark = document.querySelector(".ui-pull-refresh");
  const safe = mark == null ? 0 : px(getComputedStyle(mark).top);
  return top >= PULL_THRESHOLD_PX + safe ? top - safe : top / (1 + safe / PULL_THRESHOLD_PX);
}

function tick() {
  if (typeof navigator.vibrate === "function") navigator.vibrate(10);
}

export function PullRefresh({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>({ phase: "idle", travel: 0, tone: "page" });
  const screen = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let alive = true;
    let closeTimer = 0;
    let tone: PullTone = "page";
    let phase: PullPhase = "idle";
    function show(next: PullPhase, travel: number) {
      phase = next;
      setView({ phase, travel, tone });
    }
    /** Glides back from `travel`: the screen returns to the top and the spinner fades. */
    function close(next: "returning" | "closing", travel: number) {
      show(next, travel);
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (alive && phase === next) show("idle", 0);
      }, CLOSE_FALLBACK_MS);
    }
    function drop() {
      const current = track.current;
      track.current = null;
      if (current?.active === true) close("closing", current.travel);
    }
    function onStart(event: TouchEvent) {
      if (track.current != null) drop();
      const returning = phase === "returning" || phase === "closing";
      if ((phase !== "idle" && !returning) || event.touches.length !== 1 || !pullAvailable() || !atTop()) return;
      const touch = event.touches[0];
      if (touch == null || inEdgeZone(touch.clientX, window.innerWidth) || pullBlocked(event.target)) return;
      track.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: null, active: false, from: 0, travel: 0, ticked: false };
      if (!returning) return;
      // The screen is on its way back: the finger catches it where it is and pulls on from there.
      window.clearTimeout(closeTimer);
      const travel = liveTravel(screen.current);
      Object.assign(track.current, { axis: "y", active: true, from: pullMove(travel), travel });
      show("pulling", travel);
    }
    function onMove(event: TouchEvent) {
      const current = track.current;
      if (current == null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === current.id);
      if (touch == null || event.touches.length !== 1) {
        drop();
        return;
      }
      if (!current.active) {
        const dy = touch.clientY - current.y;
        const axis = lockAxis(current, touch.clientX - current.x, dy);
        if (axis == null) return;
        // Sideways goes to the row, period and card swipes; upward to the page scroll.
        if (axis === "x" || dy <= 0 || !atTop()) {
          track.current = null;
          return;
        }
        // The move counts from here, so the screen starts at 0 and does not jump by the decision's 10px.
        current.active = true;
        current.y = touch.clientY;
        tone = pullTone(screen.current);
      }
      // From here the pull owns the touch, so the page does not scroll under it.
      if (event.cancelable) event.preventDefault();
      current.travel = pullTravel(current.from + touch.clientY - current.y);
      if (!current.ticked && pullArmed(current.travel)) {
        current.ticked = true;
        tick();
      }
      show("pulling", current.travel);
    }
    function onEnd() {
      const current = track.current;
      track.current = null;
      if (current?.active !== true) return;
      if (!pullArmed(current.travel)) {
        close("closing", current.travel);
        return;
      }
      show("refreshing", PULL_REST_PX);
      void refreshAll(client).then((ok) => {
        if (!alive) return;
        if (!ok) toastRef.current.show({ tone: "bad", message: PULL_FAILED });
        close("returning", PULL_REST_PX);
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

/** A spoke's opacity while the spinner turns: full at the head, fading round to a quarter behind it. */
function tail(spoke: number): number {
  return 1 - (((PULL_SPOKES - spoke) % PULL_SPOKES) * 0.75) / (PULL_SPOKES - 1);
}

/**
 * The iOS activity indicator: 12 thin rounded spokes, clockwise from 12 o'clock, in `currentColor`.
 * While pulling, the first `shown` stand at full strength and the rest are hidden; turning, they fade
 * round from the head (the CSS turns it in 12 steps). With reduced motion the CSS stops the turn, so
 * a refreshing spinner keeps this fade on spokes that stand still, and a pulling one shows all 12.
 */
function Spokes({ shown, turning }: { shown: number; turning: boolean }) {
  return (
    <svg className="ui-pull-spinner" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
      {Array.from({ length: PULL_SPOKES }, (_, spoke) => (
        <line
          key={spoke}
          x1="10"
          y1="1.6"
          x2="10"
          y2="5"
          transform={`rotate(${String((spoke * 360) / PULL_SPOKES)} 10 10)`}
          opacity={turning ? tail(spoke) : spoke < shown ? 1 : 0}
        />
      ))}
    </svg>
  );
}

/**
 * Exported for the stories, which draw each phase. The pulled screen, the gap above it (the screen's
 * own first child, so it moves with it) and the spinner in the gap. While pulling (and closing) the spinner shows `pullSpokes(travel)` spokes,
 * standing still; refreshing and returning, all 12 turn and the screen rests at PULL_REST_PX (the CSS
 * glides it back on returning and closing). The screen moves by `top` on a relative box, not a
 * transform, so the bars it pins (`position: fixed`: the action bar, the card's step row, a save
 * bar) keep the viewport and stay put. With reduced motion the screen does not move: the spinner
 * fades in where it rests, its spokes still.
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
  const turning = phase === "refreshing" || phase === "returning";
  const idle = phase === "idle";
  const style = {
    "--pull-y": `${String(travel)}px`,
    "--pull-progress": String(turning ? 1 : Math.min(1, travel / PULL_THRESHOLD_PX)),
    "--pull-rest": `${String(PULL_REST_PX)}px`,
  } as CSSProperties;
  return (
    <>
      {idle ? null : (
        <>
          <div className="ui-pull-refresh" data-phase={phase} data-tone={tone} style={style} aria-hidden="true">
            <Spokes shown={turning ? PULL_SPOKES : pullSpokes(travel)} turning={turning} />
          </div>
        </>
      )}
      <div ref={screenRef} className="ui-pull-screen" data-phase={idle ? undefined : phase} style={idle ? undefined : style}>
        {idle ? null : <div className="ui-pull-gap" data-tone={tone} aria-hidden="true" />}
        {children}
      </div>
      <div role="status" className="sr-only">
        {phase === "refreshing" ? "מרענן" : null}
      </div>
    </>
  );
}
