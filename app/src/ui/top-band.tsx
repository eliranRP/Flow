import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { ChevronDownIcon } from "./icons";
import { Wordmark } from "./wordmark";

type TopBandProps = {
  children?: ReactNode;
  /** The band's figures: the page's gutter, then the title, label and figure stacked (the band's one hero block). */
  hero?: ReactNode;
  /** Opt-in class on the hero block, for a page whose band differs (the project's). */
  heroClassName?: string;
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

/**
 * Opacity of the band's figures at `scrollY`, linear between the two, rounded to 0.05. A page that
 * cannot scroll to FADE_TO ends the fade at its bottom (less a pixel for subpixel scroll), so the
 * figures are gone and the compact bar shows there, never a half-faded band with no bar.
 */
export function bandFade(scrollY: number, maxScroll = Number.POSITIVE_INFINITY): number {
  const end = maxScroll - 1 > FADE_FROM ? Math.min(FADE_TO, maxScroll - 1) : FADE_TO;
  const linear = (end - scrollY) / (end - FADE_FROM);
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
      element.style.setProperty("--band-fade", String(bandFade(window.scrollY, pageMaxScroll())));
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
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) cancelAnimationFrame(frame);
    };
  }, [band]);
}

/** How far the page can scroll. */
function pageMaxScroll(): number {
  return document.documentElement.scrollHeight - window.innerHeight;
}

/** Whether a page that scrolls more than FADE_FROM is at its bottom (less a pixel for subpixel scroll). */
export function pageAtEnd(scrollY: number, maxScroll: number): boolean {
  return maxScroll - 1 > FADE_FROM && scrollY >= maxScroll - 1;
}

function bandGone(scrollY: number, maxScroll: number): boolean {
  return bandFade(scrollY, maxScroll) === 0;
}

/**
 * `read(scrollY, maxScroll)`, read once on mount, then once per frame on scroll and on resize (the
 * page's height or the viewport changing moves the bottom without a scroll).
 */
function usePageScroll(read: (scrollY: number, maxScroll: number) => boolean): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let pending = false;
    let frame = 0;
    const update = () => {
      setValue(read(window.scrollY, pageMaxScroll()));
    };
    const onScroll = () => {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(() => {
        pending = false;
        update();
      });
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (pending) cancelAnimationFrame(frame);
    };
  }, [read]);
  return value;
}

/** Whether the band's figures are gone (bandFade 0): Home's compact bar shows from there. */
export function useBandGone(): boolean {
  return usePageScroll(bandGone);
}

/** Whether the page is scrolled to its bottom: a page too short to scroll its mark under the bar shows the bar there. */
export function usePageAtEnd(): boolean {
  return usePageScroll(pageAtEnd);
}

/** Violet band. Home and the Project header only. */
export function TopBand({ children, hero, heroClassName, trailing, leading, status, example, preview = false, wordmark = true, tone = "current" }: TopBandProps) {
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
      {hero == null ? null : <div className={heroClassName == null ? "ui-band-hero" : `ui-band-hero ${heroClassName}`}>{hero}</div>}
      {children}
      {preview ? <p className="ui-preview-banner t-caption t-muted">מצב תצוגה</p> : null}
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
