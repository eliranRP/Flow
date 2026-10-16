import { useEffect, useRef, useState } from "react";
import { IconButton } from "../ui/icon-button";
import { ListRow } from "../ui/list-row";
import { PauseIcon, PlayIcon } from "../ui/icons";
import type { MovieRow, MovieScene } from "./movie-scenes";

/** One scene every 2.4 seconds (FLOW-514 §2). */
export const MOVIE_INTERVAL_MS = 2400;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

function Mark({ row }: { row: MovieRow }) {
  return <span className="ui-movie-mark" aria-hidden="true">{row.mark}</span>;
}

function SceneRows({ scene }: { scene: MovieScene }) {
  return (
    <div className="ui-movie-rows">
      {scene.rows.map((row, index) => (
        <ListRow
          key={`${row.title}-${String(index)}`}
          variant="static"
          layout="inset"
          className={row.highlighted ? "ui-movie-row ui-movie-row-hi" : "ui-movie-row"}
          icon={<Mark row={row} />}
          title={row.title}
          hint={row.meta}
          meta={row.amount == null ? undefined : <span className={row.amountTone === "income" ? "ui-movie-amt ui-movie-amt-in" : "ui-movie-amt"}>{row.amount}</span>}
          tag={row.tag == null ? undefined : <span className={`ui-movie-tag ui-movie-tag-${row.tag.tone}`}>{row.tag.label}</span>}
        />
      ))}
      {scene.pill ? <span className="ui-movie-pill">{scene.pill}</span> : null}
    </div>
  );
}

/**
 * The movie (FLOW-514 §2): three scenes stacked in a phone-shaped panel, a finger that taps what
 * changes, and a loop. It pauses when asked, when the tab is hidden and when it is off screen. Under
 * reduced motion it shows the last scene and does not loop.
 */
export function SetupMovie({
  scenes,
  label,
  forceReducedMotion,
  startPaused = false,
}: {
  scenes: [MovieScene, MovieScene, MovieScene];
  /** The section's accessible name. */
  label: string;
  /** Stories pin the reduced-motion case; the app reads the system setting. */
  forceReducedMotion?: boolean;
  startPaused?: boolean;
}) {
  const reduced = forceReducedMotion ?? prefersReducedMotion();
  const [index, setIndex] = useState(reduced ? 2 : 0);
  const [paused, setPaused] = useState(startPaused);
  const [offScreen, setOffScreen] = useState(false);
  const [tabHidden, setTabHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const ref = useRef<HTMLElement>(null);
  const running = !reduced && !paused && !offScreen && !tabHidden;

  useEffect(() => {
    function onVisibility() {
      setTabHidden(document.hidden);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      setOffScreen(entries.some((entry) => !entry.isIntersecting));
    });
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => { setIndex((current) => (current + 1) % 3); }, MOVIE_INTERVAL_MS);
    return () => { window.clearInterval(id); };
  }, [running]);

  const current = scenes[index] ?? scenes[0];
  const tapY = current.tapY;
  return (
    <section ref={ref} className="ui-movie" aria-label={label} data-reduced={reduced ? "true" : undefined}>
      <div className="ui-movie-panel">
        <div className="ui-movie-phone">
          {scenes.map((scene, sceneIndex) => {
            const offset = (sceneIndex - index + 3) % 3;
            const pos = offset === 0 ? "current" : offset === 1 ? "after" : "before";
            return (
              <div key={sceneIndex} className="ui-movie-scene" data-pos={pos} aria-hidden={offset !== 0}>
                <SceneRows scene={scene} />
              </div>
            );
          })}
          <span
            className="ui-movie-finger"
            aria-hidden="true"
            data-on={tapY == null ? undefined : "true"}
            style={tapY == null ? undefined : { top: `${String(tapY + 18)}px` }}
          />
        </div>
      </div>
      <div className="ui-movie-controls">
        {reduced ? null : (
          <IconButton
            label={paused ? "הפעלה" : "השהיה"}
            className="ui-movie-toggle"
            onClick={() => { setPaused((value) => !value); }}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </IconButton>
        )}
        <p className="ui-movie-caption t-body" aria-live="polite">{current.caption}</p>
        <span className="ui-movie-dots" aria-hidden="true">
          {scenes.map((_, dot) => (
            <span key={dot} className="ui-movie-dot" data-current={dot === index ? "true" : undefined} />
          ))}
        </span>
      </div>
    </section>
  );
}
