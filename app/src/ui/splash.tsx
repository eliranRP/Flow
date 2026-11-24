import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import "./lazy.css";
import { watchHomeReady } from "./splash-ready";
import { Wordmark } from "./wordmark";

/**
 * FLOW-1277: the splash. A violet tile fills with liquid and ends as the app icon (a violet tile, a white F);
 * the wordmark fades in under it. Decorative: aria-hidden, no focusable part, so it never holds focus or
 * is read out. The owner's pick, 2026-11-23: concept N3, slowed down. FLOW-1303 (the owner's choice,
 * 2026-11-24, "End when data is ready"): it ends when Home's first figures are drawn, not on a fixed clock.
 */

// The same numbers as the --motion-splash-word* tokens (the test checks them); the timer below needs them in JS.
export const SPLASH_WORD_DELAY_MS = 2300;
export const SPLASH_WORD_MS = 400;
/** When the animation reaches its end state (the wordmark has arrived): the longest it runs. */
export const SPLASH_END_MS = SPLASH_WORD_DELAY_MS + SPLASH_WORD_MS;
/** The least the splash stays on screen before its fade out, whatever the data does. */
export const SPLASH_MIN_MS = 800;
/** When the data is ready early, the rest of the animation is sped up to arrive in this long. */
export const SPLASH_FINISH_MS = 400;
/** The splash is gone by this long after it shows, data or not (its fade out included). */
export const SPLASH_FAILSAFE_MS = 3000;
/** The fade out, the value of --motion-toast-out. A tap uses the same quick fade. */
export const SPLASH_FADE_MS = 160;
/** Reduced motion: the finished icon and wordmark stay this long. */
export const SPLASH_REDUCED_HOLD_MS = 400;

// The path, wave and translate numbers here and in css/67-splash.css are viewBox-100 units, not CSS pixels.
const F_PATH =
  "M35.07 75.00 C34.07 75.00 33.29 74.21 33.29 73.21 L33.29 26.79 C33.29 25.79 34.07 25.00 35.07 25.00 L67.93 25.00 C68.93 25.00 69.71 25.79 69.71 26.79 L69.71 34.00 C69.71 35.00 68.93 35.79 67.93 35.79 L45.86 35.79 L45.86 46.29 L66.50 46.29 C67.50 46.29 68.29 47.07 68.29 48.07 L68.29 55.29 C68.29 56.29 67.50 57.07 66.50 57.07 L45.86 57.07 L45.86 73.21 C45.86 74.21 45.07 75.00 44.07 75.00 Z";
/** The liquid's surface: a wave of period 50, wide enough to slide a whole cycle left. */
const WAVE_PATH =
  "M-100 8 Q-87.5 0 -75 8 T-50 8 T-25 8 T0 8 T25 8 T50 8 T75 8 T100 8 T125 8 T150 8 T175 8 T200 8 V140 H-100 Z";

/**
 * The tile, the liquid and the wordmark. `at` freezes the timeline at that many ms from the start
 * (stories and tests); left out, it plays.
 */
export function SplashMark({ at }: { at?: number }) {
  const id = useId();
  const clip = `${id}-tile`;
  const mask = `${id}-liquid`;
  const frozen = at != null;
  const style = frozen ? ({ "--splash-at": `${String(at)}ms` } as CSSProperties) : undefined;
  return (
    <div className="ui-splash-stage" data-frozen={frozen || undefined} style={style}>
      <svg className="ui-splash-icon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={clip}>
            <rect x="2" y="2" width="96" height="96" rx="21" />
          </clipPath>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <g clipPath={`url(#${clip})`}>
              <g className="ui-splash-rise">
                <path className="ui-splash-wave" fill="#FFFFFF" d={WAVE_PATH} />
              </g>
            </g>
          </mask>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <g className="ui-splash-rise">
            <path className="ui-splash-wave ui-splash-liquid" d={WAVE_PATH} />
          </g>
        </g>
        <path className="ui-splash-f" d={F_PATH} />
        <path className="ui-splash-f-lit" d={F_PATH} mask={`url(#${mask})`} />
        <rect className="ui-splash-edge" x="2" y="2" width="96" height="96" rx="21" fill="none" strokeWidth="3" />
      </svg>
      <div className="ui-splash-word">
        <Wordmark size="signin" />
      </div>
    </div>
  );
}

/**
 * Plays what is left of the animation faster, so it reaches its end state in `ms` instead of being cut off
 * mid-wave. Only the playback rate changes, so the motion stays continuous. A browser without the Web
 * Animations API leaves the animation as it is; the fade out still follows.
 */
function finishWithin(overlay: HTMLElement, remainingMs: number, ms: number) {
  if (ms <= 0 || remainingMs <= ms || typeof overlay.getAnimations !== "function") return;
  for (const animation of overlay.getAnimations({ subtree: true })) animation.updatePlaybackRate(remainingMs / ms);
}

/**
 * The overlay over the app: the page colour, the mark in the middle. The app is mounted and loading under
 * it. It ends when Home's first figures are drawn (or the app shows a login or an error screen): after at
 * least `SPLASH_MIN_MS`, with the rest of the fill brought quickly to its end. With no data it stays until
 * the failsafe, `SPLASH_FAILSAFE_MS` in all. A tap or a key skips it. Under reduced motion it shows the
 * finished icon for a short hold and does not wait for data. `onDone` runs once its fade out is over.
 * `watch` is for stories: how it learns the data is ready.
 */
export function Splash({ onDone, watch = watchHomeReady }: { onDone: () => void; watch?: typeof watchHomeReady }) {
  const [leaving, setLeaving] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const leave = useCallback(() => {
    setLeaving(true);
  }, []);
  useEffect(() => {
    if (leaving) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shownAt = performance.now();
    const timers: number[] = [];
    let stopWatching: () => void = () => undefined;
    if (reduced) {
      timers.push(window.setTimeout(leave, SPLASH_REDUCED_HOLD_MS));
    } else {
      timers.push(window.setTimeout(leave, SPLASH_FAILSAFE_MS - SPLASH_FADE_MS));
      stopWatching = watch(() => {
        // The fade out starts after the minimum and after the fill has had `SPLASH_FINISH_MS` to arrive,
        // but never later than the animation's own end.
        const elapsed = performance.now() - shownAt;
        const remaining = Math.max(SPLASH_END_MS - elapsed, 0);
        const wait = Math.min(Math.max(SPLASH_MIN_MS - elapsed, SPLASH_FINISH_MS), remaining);
        if (overlay.current) finishWithin(overlay.current, remaining, wait);
        timers.push(window.setTimeout(leave, wait));
      });
    }
    window.addEventListener("keydown", leave);
    return () => {
      stopWatching();
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("keydown", leave);
    };
  }, [leaving, leave, watch]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDone, SPLASH_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, onDone]);
  return (
    <div ref={overlay} className="ui-splash" data-leaving={leaving || undefined} aria-hidden="true" onPointerDown={leave}>
      <SplashMark />
    </div>
  );
}
