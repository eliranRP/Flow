import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { RefreshIcon } from "./icons";
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

type ShellSnapshot = {
  settled: boolean;
  reducedMotion: boolean;
};

type PlaybackStore = {
  get: () => DemoPlayback;
  getShell: () => ShellSnapshot;
  set: (next: DemoPlayback) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeShell: (listener: () => void) => () => void;
};

const DemoStoreContext = createContext<PlaybackStore | null>(null);

function createPlaybackStore(initial: DemoPlayback): PlaybackStore {
  let snap = initial;
  let shell: ShellSnapshot = { settled: initial.settled, reducedMotion: initial.reducedMotion };
  const listeners = new Set<() => void>();
  const shellListeners = new Set<() => void>();
  return {
    get: () => snap,
    getShell: () => shell,
    set(next) {
      if (next.progress === snap.progress && next.settled === snap.settled && next.reducedMotion === snap.reducedMotion) return;
      const shellSame = next.settled === shell.settled && next.reducedMotion === shell.reducedMotion;
      snap = next;
      for (const listener of listeners) listener();
      if (!shellSame) {
        shell = { settled: next.settled, reducedMotion: next.reducedMotion };
        for (const listener of shellListeners) listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeShell(listener) {
      shellListeners.add(listener);
      return () => {
        shellListeners.delete(listener);
      };
    },
  };
}

export function useDemoPlayback(): DemoPlayback {
  const store = useContext(DemoStoreContext);
  if (!store) throw new Error("useDemoPlayback must be used inside DemoPlayer");
  return useSyncExternalStore(store.subscribe, store.get, store.get);
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

function readReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type DemoPlayerProps = {
  /** Visually hidden sentence. The phone is hidden from assistive tech. */
  alt: string;
  /** Play length in milliseconds. The setup demos use 3000–4600. */
  durationMs: number;
  children: ReactNode;
};

/**
 * Tint stage with a phone outline rising from the bottom.
 * Plays once, rests on the last frame, then shows שוב in the end corner.
 * Sets `--inline-sign` (−1 under RTL) once, and writes `--demo-progress` (0 to 1) on the stage.
 * `prefers-reduced-motion` shows the last frame and does not render שוב.
 * Pauses while the tab is hidden or the stage is off screen, and does not restart on resize.
 * The phone is scaled from a 320px screen (0.6125 at a 390 viewport).
 */
export function DemoPlayer({ alt, durationMs, children }: DemoPlayerProps) {
  const storeRef = useRef<PlaybackStore | null>(null);
  if (!storeRef.current) {
    const reducedMotion = readReducedMotion();
    storeRef.current = createPlaybackStore({
      progress: reducedMotion ? 1 : 0,
      settled: reducedMotion,
      reducedMotion,
    });
  }
  const store = storeRef.current;
  const shell = useSyncExternalStore(store.subscribeShell, store.getShell, store.getShell);
  const [runId, setRunId] = useState(0);
  const [sign, setSign] = useState(() => inlineSignForDirection(document.documentElement.dir || "rtl"));
  const [showReplay, setShowReplay] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const replayFocus = useRef(false);
  const reduced = shell.reducedMotion;
  const settled = shell.settled;

  const publish = useCallback((progress: number, nextSettled: boolean, reducedMotion: boolean) => {
    rootRef.current?.style.setProperty("--demo-progress", String(progress));
    store.set({ progress, settled: nextSettled, reducedMotion });
  }, [store]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      const matches = media.matches;
      const current = store.get();
      publish(matches ? 1 : current.progress, matches ? true : current.settled, matches);
    };
    media.addEventListener("change", onChange);
    onChange();
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [publish, store]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const next = inlineSignForDirection(getComputedStyle(el).direction);
    setSign((current) => (current === next ? current : next));
  }, []);

  useLayoutEffect(() => {
    const phone = phoneRef.current;
    const root = rootRef.current;
    if (!phone || !root || typeof ResizeObserver !== "function") return;
    const apply = () => {
      const width = phone.getBoundingClientRect().width;
      if (width > 0) root.style.setProperty("--demo-scale", String(width / 320));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(phone);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (reduced || !Number.isFinite(durationMs) || durationMs <= 0) {
      publish(1, true, reduced);
      return;
    }
    publish(0, false, false);
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
      publish(next, next >= 1, false);
      if (next >= 1) return;
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
  }, [publish, reduced, durationMs, runId, store]);

  useEffect(() => {
    if (settled && !reduced) setShowReplay(true);
  }, [settled, reduced]);

  useLayoutEffect(() => {
    if (!replayFocus.current || reduced || !showReplay) return;
    const button = rootRef.current?.querySelector(".ui-demo-replay");
    if (button instanceof HTMLButtonElement) button.focus();
  }, [runId, settled, reduced, showReplay]);

  function replay() {
    if (reduced) return;
    replayFocus.current = true;
    setRunId((id) => id + 1);
  }

  const demoStyle = {
    "--inline-sign": String(sign),
    "--demo-progress": String(store.get().progress),
  } as CSSProperties;
  const replayVisible = showReplay && !reduced;

  return (
    <div ref={rootRef} className="ui-demo" data-demo-state={settled ? "settled" : "playing"} data-reduced-motion={reduced ? "true" : "false"} style={demoStyle}>
      <p className="ui-toast-live">{alt}</p>
      <div ref={phoneRef} className="ui-demo-phone" aria-hidden="true" inert>
        <div className="ui-demo-fit">
          <div className="ui-demo-screen">
            <DemoStoreContext.Provider value={store}>{children}</DemoStoreContext.Provider>
          </div>
        </div>
      </div>
      {replayVisible ? (
        <Button variant="pill" className="ui-demo-replay" icon={<RefreshIcon size={14} />} aria-hidden={settled ? undefined : true} onClick={replay}>
          שוב
        </Button>
      ) : null}
    </div>
  );
}
