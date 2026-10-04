import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "./button";
import "./demo-player.css";

/** Setup demos play for 3.0–4.6 seconds. The player accepts other lengths for tests. */
export const DEMO_DURATION_MIN_MS = 3000;
export const DEMO_DURATION_MAX_MS = 4600;

export type DemoPlayback = {
  /** 0 on the first frame, 1 on the last frame. */
  progress: number;
  /** True after the single play finishes, or immediately when motion is reduced. */
  settled: boolean;
  reducedMotion: boolean;
};

const DemoPlaybackContext = createContext<DemoPlayback | null>(null);

export function useDemoPlayback(): DemoPlayback {
  const value = useContext(DemoPlaybackContext);
  if (!value) throw new Error("useDemoPlayback must be used inside DemoPlayer");
  return value;
}

/** 1 in LTR, −1 in RTL. Forward motion is `translateX(calc(var(--inline-sign) * N))`. */
export function inlineSignForDirection(direction: string): number {
  return direction === "rtl" ? -1 : 1;
}

/**
 * Progress of a play that runs once. Reduced motion is the last frame.
 * A non-positive duration also rests on the last frame, so the clock cannot loop.
 */
export function demoProgress(elapsedMs: number, durationMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return 1;
  return elapsedMs / durationMs;
}

/** Physical translateX, in px, for travel toward rest. 0 at the last frame. */
export function demoTranslateX(progress: number, travelPx: number, inlineSign: number): number {
  if (progress >= 1) return 0;
  return inlineSign * (progress - 1) * travelPx;
}

function readReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type DemoPlayerProps = {
  /** Visually hidden sentence. The phone is hidden from assistive tech. */
  alt: string;
  /** Play length in milliseconds. The setup demos use 3000–5000. */
  durationMs: number;
  children: ReactNode;
};

/**
 * Tint stage with a phone outline rising from the bottom.
 * Plays once, rests on the last frame, then shows שוב in the end corner.
 * Sets `--inline-sign` (−1 under RTL) and `--demo-progress` (0 to 1).
 * `prefers-reduced-motion` shows the last frame and does not render שוב.
 * Pauses while the tab is hidden or the stage is off screen, and does not restart on resize.
 * The phone is scaled from a 320px screen (0.6125 at a 390 viewport).
 */
export function DemoPlayer({ alt, durationMs, children }: DemoPlayerProps) {
  const [reduced, setReduced] = useState(readReducedMotion);
  const [runId, setRunId] = useState(0);
  const [progress, setProgress] = useState(() => (readReducedMotion() ? 1 : 0));
  const [settled, setSettled] = useState(readReducedMotion);
  const [sign, setSign] = useState(() => inlineSignForDirection(document.documentElement.dir || "rtl"));
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const wasSettled = useRef(settled);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(media.matches);
    };
    media.addEventListener("change", onChange);
    setReduced(media.matches);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = () => {
      setSign(inlineSignForDirection(getComputedStyle(el).direction));
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (reduced || !Number.isFinite(durationMs) || durationMs <= 0) {
      setProgress(1);
      setSettled(true);
      return;
    }
    setSettled(false);
    setProgress(0);
    const root = rootRef.current;
    let started: number | null = null;
    let lastElapsed = -1;
    let resume = false;
    let frame = 0;
    let stopped = false;
    let running = false;
    let hidden = document.hidden;
    let onScreen = typeof IntersectionObserver !== "function";

    const stopFrame = () => {
      cancelAnimationFrame(frame);
      running = false;
    };

    const tick = (now: number) => {
      running = false;
      if (stopped || hidden || !onScreen) return;
      const stamp = Number.isFinite(now) ? now : 0;
      if (started === null || resume) {
        started = stamp - Math.max(lastElapsed, 0);
        resume = false;
      }
      let elapsed = stamp - started;
      // A clock that does not move still has to finish, or the play would loop.
      if (lastElapsed >= 0 && elapsed <= lastElapsed) elapsed = lastElapsed + 16;
      if (elapsed < 0) elapsed = 0;
      lastElapsed = elapsed;
      const next = demoProgress(elapsed, durationMs, false);
      setProgress(next);
      if (next >= 1) {
        setSettled(true);
        return;
      }
      frame = requestAnimationFrame(tick);
      running = true;
    };

    const kick = () => {
      if (stopped || hidden || !onScreen || running || lastElapsed >= durationMs) return;
      frame = requestAnimationFrame(tick);
      running = true;
    };

    const pause = () => {
      stopFrame();
      resume = true;
    };

    const onVis = () => {
      hidden = document.hidden;
      if (hidden) pause();
      else kick();
    };
    document.addEventListener("visibilitychange", onVis);

    let observer: IntersectionObserver | null = null;
    if (root && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting && entry.target === root);
        onScreen = visible;
        if (!visible) pause();
        else kick();
      });
      observer.observe(root);
    } else {
      kick();
    }

    return () => {
      stopped = true;
      stopFrame();
      document.removeEventListener("visibilitychange", onVis);
      observer?.disconnect();
    };
  }, [reduced, durationMs, runId]);

  useLayoutEffect(() => {
    const returned = settled && !wasSettled.current;
    wasSettled.current = settled;
    if (!returned || reduced || !restoreFocus.current) return;
    const button = rootRef.current?.querySelector(".ui-demo-replay");
    if (button instanceof HTMLButtonElement) button.focus();
    restoreFocus.current = false;
  }, [settled, reduced]);

  function replay() {
    if (reduced) return;
    restoreFocus.current = true;
    setRunId((id) => id + 1);
  }

  const playback: DemoPlayback = { progress, settled, reducedMotion: reduced };
  const demoStyle = {
    "--inline-sign": String(sign),
    "--demo-progress": String(progress),
  } as CSSProperties;

  return (
    <div ref={rootRef} className="ui-demo" data-demo-state={settled ? "settled" : "playing"} data-reduced-motion={reduced ? "true" : "false"} style={demoStyle}>
      <p className="ui-demo-label">{alt}</p>
      <div className="ui-demo-phone" aria-hidden="true" inert>
        <div className="ui-demo-fit">
          <div className="ui-demo-screen">
            <DemoPlaybackContext.Provider value={playback}>{children}</DemoPlaybackContext.Provider>
          </div>
        </div>
      </div>
      {settled && !reduced ? (
        <Button variant="pill" className="ui-demo-replay" aria-label="הצגה חוזרת" onClick={replay}>
          שוב
        </Button>
      ) : null}
    </div>
  );
}
