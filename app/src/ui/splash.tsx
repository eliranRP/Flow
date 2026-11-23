import { useCallback, useEffect, useId, useState, type CSSProperties } from "react";
import "./lazy.css";
import { Wordmark } from "./wordmark";

/**
 * FLOW-1277: the splash. A violet tile fills with liquid and ends as the app icon (a violet tile, a white F);
 * the wordmark fades in under it. Decorative: aria-hidden, no focusable part, so it never holds focus or
 * is read out. The owner's pick, 2026-11-23: concept N3, slowed down.
 */

// The same numbers as the --motion-splash-word* tokens (the test checks them); the timer below needs them in JS.
export const SPLASH_WORD_DELAY_MS = 2300;
export const SPLASH_WORD_MS = 400;
/** When the fade out starts: the wordmark has arrived. */
export const SPLASH_END_MS = SPLASH_WORD_DELAY_MS + SPLASH_WORD_MS;
/** The fade out, the value of --motion-toast-out. A tap uses the same quick fade. */
export const SPLASH_FADE_MS = 160;
/** Reduced motion: the finished icon and wordmark stay this long. */
export const SPLASH_REDUCED_HOLD_MS = 400;

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
  const style = frozen ? ({ "--splash-at": `${at}ms` } as CSSProperties) : undefined;
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
 * The overlay over the app: the page colour, the mark in the middle. The app is mounted and loading under
 * it. It leaves by itself after the wordmark has arrived (after a short hold under reduced motion), or at a
 * tap or a key; `onDone` runs once its fade out is over.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(() => setLeaving(true), []);
  useEffect(() => {
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(leave, reduced ? SPLASH_REDUCED_HOLD_MS : SPLASH_END_MS);
    window.addEventListener("keydown", leave);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", leave);
    };
  }, [leave]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onDone, SPLASH_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onDone]);
  return (
    <div className="ui-splash" data-leaving={leaving || undefined} aria-hidden="true" onPointerDown={leave}>
      <SplashMark />
    </div>
  );
}
