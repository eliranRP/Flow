import { useEffect, useRef, type ReactNode, type Ref, type RefObject } from "react";
import { ChevronDownIcon } from "./icons";
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
  /** FLOW-364: a past month's band is the darker one. */
  tone?: "current" | "past";
};

/** The figures are full until the page is 60px down, and gone at 220px (Motion board, FLOW-363 3a). */
const FADE_FROM = 60;
const FADE_TO = 220;

/** Opacity of the band's figures at `scrollY`, linear between the two, rounded to 0.05. */
export function bandFade(scrollY: number): number {
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
export function TopBand({ children, trailing, leading, status, example, preview = false, wordmark = true, tone = "current" }: TopBandProps) {
  const band = useRef<HTMLElement>(null);
  useBandFade(band);
  return (
    <header ref={band} className={tone === "past" ? "ui-band ui-band-past" : "ui-band"}>
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

/**
 * FLOW-601 (mockup a-3), folded into the band in FLOW-364. The company's name at the start of
 * Home's band row. It ends in the 16px ▼ every band label that opens a sheet uses (FLOW-335), and
 * opens the חברה sheet.
 */
export function BandCompany({
  name,
  onOpen,
  buttonRef,
}: {
  name: string;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="ui-band-company"
      aria-haspopup="dialog"
      aria-label={`חברה: ${name}`}
      onClick={onOpen}
    >
      <span className="ui-band-company-name" data-clip-ok="">{name}</span>
      <ChevronDownIcon size={14} />
    </button>
  );
}
