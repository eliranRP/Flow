import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackButton } from "./back";
import { CompactBar } from "./compact-bar";
import { FocusTitle } from "./focus-title";

type HeaderChrome = {
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
  /**
   * FLOW-444: Back's label when Back goes to a page other than the kicker's (a month opened from
   * "לפי חודש" goes back to that list). The kicker then stays a line, so the page still names its project.
   */
  backText?: string;
  /** Replaces the back control. Transaction and Split pass their own icon button. */
  leading?: ReactNode;
  /** Sits on the end of the bar. */
  trailing?: ReactNode;
  /** A stacked page's own control under the title, on the start side (the breakdown's period pill, FLOW-334). */
  below?: ReactNode;
  /** A stacked title's own controls at the end of its line (a month page's chevrons, FLOW-362). */
  titleAside?: ReactNode;
  /** The figure after the title on the compact bar, e.g. an Amount (FLOW-363 3a). */
  compactFigure?: ReactNode;
  /** A row under the compact bar, e.g. the organize chips (FLOW-363 3c). The bar then shows once it scrolls off. */
  panel?: ReactNode;
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
    backText,
    leading,
    trailing,
    below,
    titleAside,
    compactFigure,
    panel,
    size = "default",
    subtitleClassName,
  } = props;
  const barOnly = props.barOnly === true;
  const title = props.title;
  // FLOW-334 H2 (decision 0156): with a Back, the kicker names where it goes, so it becomes Back's label.
  const backLabel = backText ?? kicker;
  const labelledBack = leading == null && backTo != null && backLabel != null && backLabel !== "";
  const start = leading ?? (backTo ? <BackButton fallback={backTo} text={labelledBack ? backLabel : undefined} /> : null);
  const stacked = props.layout === "stacked"
    || (props.layout == null && !barOnly && start != null && size !== "compact");
  const kickerLine = kicker && (!labelledBack || backText != null) ? <p className="t-hint">{kicker}</p> : null;
  // FLOW-334 H1: a long stacked page keeps Back in a compact bar once the large title scrolls off.
  const compact = stacked && leading == null && backTo != null && title != null;
  const titleEnd = useRef<HTMLSpanElement>(null);
  const past = useScrolledPast(titleEnd, compact);
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
      {stacked && title != null ? (
        titleAside != null ? (
          <div className="ui-page-title-line">
            <FocusTitle className="t-title">{title}</FocusTitle>
            {titleAside}
          </div>
        ) : (
          <FocusTitle className="t-title">{title}</FocusTitle>
        )
      ) : null}
      {compact && panel == null ? <span ref={titleEnd} className="ui-compact-mark" aria-hidden="true" /> : null}
      {subtitle ? <p className={subtitleClass(subtitleClassName, stacked)}>{subtitle}</p> : null}
      {below != null ? <div className="ui-page-below">{below}</div> : null}
      {compact && panel != null ? <span ref={titleEnd} className="ui-compact-mark" aria-hidden="true" /> : null}
      {compact ? (
        <CompactBar
          title={title}
          backTo={backTo}
          label={labelledBack ? kicker : undefined}
          figure={compactFigure}
          shown={past}
          panel={panel}
        />
      ) : null}
    </header>
  );
}

/** The compact bar's height under the safe area: one touch target. */
const COMPACT_BAR = 44;

/** The safe area on top (installed app under a notch), in px. --safe-top is an env(), so a probe resolves it. */
function safeTop(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;padding-top:var(--safe-top)";
  document.body.append(probe);
  const value = Number.parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

/** True once the mark has scrolled up under the compact bar. */
function useScrolledPast(mark: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const node = enabled ? mark.current : null;
    if (node == null || typeof IntersectionObserver === "undefined") return;
    const top = COMPACT_BAR + safeTop();
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < top);
      },
      { rootMargin: `-${String(top)}px 0px 0px 0px` },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mark, enabled]);
  return past;
}
