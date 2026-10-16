import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Wordmark } from "./wordmark";

type TopBandProps = {
  children?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  /** Sits above the wordmark row. Pull-to-refresh uses it for the spinner. */
  status?: ReactNode;
  /** Example tag sits on the band, not in a strip above it. */
  example?: ReactNode;
  preview?: boolean;
  /** Home and Project hide it. The default stays for the band chrome stories. */
  wordmark?: boolean;
};

/** The figures are full until the page is 60px down, and gone at 220px (Motion board, FLOW-363 3a). */
const FADE_FROM = 60;
const FADE_TO = 220;

/** Opacity of the band's figures at `scrollY`, linear between the two, rounded to 0.05. */
function bandFade(scrollY: number): number {
  const linear = (FADE_TO - scrollY) / (FADE_TO - FADE_FROM);
  const clamped = Math.min(1, Math.max(0, linear));
  return Math.round(clamped * 20) / 20;
}

/**
 * Sets `--band-fade` on the band from the page's scroll. A passive listener, one update per frame,
 * so the figures follow the finger. Not turned off under reduced motion (the Motion board keeps it).
 */
function useBandFade(band: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = band.current;
    if (element == null) return;
    let pending = false;
    let frame = 0;
    const write = () => {
      element.style.setProperty("--band-fade", String(bandFade(window.scrollY)));
    };
    const onScroll = () => {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(() => {
        pending = false;
        write();
      });
    };
    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (pending) cancelAnimationFrame(frame);
    };
  }, [band]);
}

/** Violet band. Home and the Project header only. */
export function TopBand({ children, trailing, leading, status, example, preview = false, wordmark = true }: TopBandProps) {
  const band = useRef<HTMLElement>(null);
  useBandFade(band);
  return (
    <header ref={band} className="ui-band">
      {status}
      <div className="ui-band-row">
        {leading}
        {wordmark ? <Wordmark tone="on-band" /> : null}
        {trailing}
      </div>
      {example ? <div className="ui-band-example">{example}</div> : null}
      {children}
      {preview ? <p className="ui-preview-banner t-hint">מצב תצוגה</p> : null}
    </header>
  );
}
