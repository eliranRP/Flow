import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackButton, useGoBack } from "./back";
import { FocusTitle } from "./focus-title";
import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

type HeaderChrome = {
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
  /** Replaces the back control. Transaction and Split pass their own icon button. */
  leading?: ReactNode;
  /** Sits on the end of the bar. */
  trailing?: ReactNode;
  /** Compact is the t-title-3 used on a transaction. */
  size?: "default" | "compact";
  subtitleClassName?: string;
};

/**
 * A title is required unless the header is only the bar. Stacked puts the title under that bar.
 * With a back or leading control the title stacks by default (FLOW-326, mockups 07 and 14), so it
 * starts on the start side under its kicker. A compact title and `layout="inline"` stay on the bar.
 */
export type ScreenHeaderProps =
  | (HeaderChrome & { title: string; barOnly?: false; layout?: "inline" })
  | (HeaderChrome & { barOnly: true; title?: undefined; layout?: undefined })
  | (HeaderChrome & { layout: "stacked"; title: string; barOnly?: false });

function subtitleClass(extra: string | undefined, stacked: boolean): string {
  // A stacked subtitle keeps the secondary colour with an extra class too: the reviewer card's
  // supplier line (`ui-party`) stacks now that Back stacks by default (FLOW-326).
  if (stacked) return extra ? `t-label text-text-secondary ${extra}` : "t-label text-text-secondary";
  return extra ? `t-label mt-4 text-text-secondary ${extra}` : "t-label mt-4 text-text-secondary";
}

/** One title block for every screen. A back control is for screens that are not tab roots. */
export function ScreenHeader(props: ScreenHeaderProps) {
  const {
    subtitle,
    backTo,
    action,
    kicker,
    leading,
    trailing,
    size = "default",
    subtitleClassName,
  } = props;
  const barOnly = props.barOnly === true;
  const title = props.title;
  // FLOW-334 H2 (decision 0156): with a Back, the kicker names where it goes, so it becomes Back's label.
  const labelledBack = leading == null && backTo != null && kicker != null && kicker !== "";
  const start = leading ?? (backTo ? <BackButton fallback={backTo} text={labelledBack ? kicker : undefined} /> : null);
  const stacked = props.layout === "stacked"
    || (props.layout == null && !barOnly && start != null && size !== "compact");
  const kickerLine = kicker && !labelledBack ? <p className="t-hint">{kicker}</p> : null;
  // FLOW-334 H1: a long stacked page keeps Back in a compact bar once the large title scrolls off.
  const compact = stacked && leading == null && backTo != null && title != null;
  const titleEnd = useRef<HTMLSpanElement>(null);
  return (
    <header className={stacked ? "ui-page ui-page-stacked" : props.layout === "inline" && start != null ? "ui-page ui-page-inline" : "ui-page"}>
      {stacked ? null : kickerLine}
      <div className="ui-page-title-row">
        {start}
        {barOnly || stacked || title == null ? null : (
          <FocusTitle className={size === "compact" ? "t-title-3" : "t-title-1"}>{title}</FocusTitle>
        )}
        {trailing ?? action}
      </div>
      {stacked ? kickerLine : null}
      {stacked && title != null ? <FocusTitle className="t-title-1">{title}</FocusTitle> : null}
      {compact ? <span ref={titleEnd} className="ui-compact-mark" aria-hidden="true" /> : null}
      {subtitle ? <p className={subtitleClass(subtitleClassName, stacked)}>{subtitle}</p> : null}
      {compact ? <CompactBar title={title} backTo={backTo} titleEnd={titleEnd} /> : null}
    </header>
  );
}

/** The compact bar's height, under the safe area: one touch target. */
const COMPACT_BAR = 44;

/** True once the mark has scrolled up under the compact bar. */
function useScrolledPast(mark: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const node = mark.current;
    if (node == null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < COMPACT_BAR);
      },
      { rootMargin: `-${String(COMPACT_BAR)}px 0px 0px 0px` },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mark]);
  useEffect(() => {
    // Month heads pin under the bar while it shows (11-month-lists.css reads --month-sticky-top).
    const root = document.documentElement;
    root.toggleAttribute("data-compact-bar", past);
    return () => {
      root.removeAttribute("data-compact-bar");
    };
  }, [past]);
  return past;
}

/**
 * FLOW-334 H1 (owner, 2026-10-08): Back and a small title, pinned to the top once the large title
 * has scrolled off, like iOS large titles. The page's own Back keeps the start-edge swipe.
 */
function CompactBar({ title, backTo, titleEnd }: { title: string; backTo: string; titleEnd: RefObject<HTMLElement | null> }) {
  const past = useScrolledPast(titleEnd);
  const goBack = useGoBack();
  if (!past) return null;
  return (
    <div className="ui-compact-bar">
      <div className="ui-compact-bar-row">
        <IconButton label="חזרה" onClick={() => { goBack(backTo); }}>
          <BackIcon />
        </IconButton>
        {/* The page's h1 is still there; this is its echo. */}
        <span className="ui-compact-title t-title-3" aria-hidden="true">{title}</span>
      </div>
    </div>
  );
}
