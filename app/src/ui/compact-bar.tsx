import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBackLandsOn, useGoBack } from "./back";
import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

export type CompactBarSize = "list" | "detail";

export type CompactBarProps = {
  title: string;
  /** After the title, " · " and the figure (an Amount at list size). Its own LTR run. */
  figure?: ReactNode;
  /** FLOW-445: the figure before the title, "−$X • name" (the project page's bar). */
  figureFirst?: boolean;
  /** Back's label, the parent's name (decision 0156). Without one, Back is the icon. */
  label?: string;
  /** Where Back goes. Without it the bar has no Back. */
  backTo?: string;
  /** 44px on a list page, 56px on a detail page. */
  size?: CompactBarSize;
  /** Slides in (m-bar-in) or out (m-bar-out). A hidden bar takes no focus or clicks. */
  shown: boolean;
  /** At the end of the bar. */
  actions?: ReactNode;
  /** A row under the bar that stays with it, e.g. the organize chips (FLOW-363 3c). */
  panel?: ReactNode;
  /** FLOW-364: Home's bar, in the colour band (or the past month's darker one). With `centre`, the bar is its own row. */
  tone?: "band" | "band-past";
  /** FLOW-364: Home's bar, the earlier arrow at the start. */
  start?: ReactNode;
  /** FLOW-364: Home's bar, the centre button (the month and its net). */
  centre?: ReactNode;
  /** FLOW-364: Home's bar, the later arrow at the end. */
  end?: ReactNode;
  /** FLOW-1043: a row under the bar that holds a control while `docked` (the filter that reached the bar). */
  dock?: ReactNode;
  /** FLOW-1043: the dock row is open: the bar grows by 60px (max-height, --motion-page, --ease-enter), the row fades in (160ms). */
  docked?: boolean;
};

/** A bar with a panel reports "panel": it is taller than a list or detail bar. A bar with a centre is the 64px band bar. */
type Reported = CompactBarSize | "panel" | "band";

/**
 * Bars showing, by size. The html element reports the bar it has under it: the page's sticky month
 * heads and scroll padding use the height of the bar (27-compact-header.css).
 */
const showing: Record<Reported, number> = { list: 0, detail: 0, panel: 0, band: 0 };

function reportShowing(size: Reported, delta: number): void {
  showing[size] = Math.max(0, showing[size] + delta);
  const root = document.documentElement;
  const total = showing.list + showing.detail + showing.panel + showing.band;
  if (total === 0) root.removeAttribute("data-compact-bar");
  else if (showing.panel > 0) root.setAttribute("data-compact-bar", "panel");
  else if (showing.band > 0) root.setAttribute("data-compact-bar", "band");
  else root.setAttribute("data-compact-bar", showing.detail > 0 ? "detail" : "list");
}

/** FLOW-1043: open docks. Any one sets html[data-compact-dock="on"], which adds the dock's 60px to the bar's height. */
let docksOpen = 0;

function reportDock(delta: number): void {
  docksOpen = Math.max(0, docksOpen + delta);
  if (docksOpen === 0) document.documentElement.removeAttribute("data-compact-dock");
  else document.documentElement.setAttribute("data-compact-dock", "on");
}

/**
 * The one compact bar (decision 0156 extended, FLOW-363 3a): Back on the start side, the title
 * centred in one line, an optional figure after it, actions at the end. It stays mounted once a
 * page can show it, so the slide out has something to run on; `shown` drives the classes.
 */
export function CompactBar({ title, figure, figureFirst = false, label, backTo, size = "list", shown, actions, panel, tone, start, centre, end, dock, docked = false }: CompactBarProps) {
  const reported: Reported = panel != null ? "panel" : centre != null ? "band" : size;
  const dockOpen = shown && dock != null && docked;
  const goBack = useGoBack();
  const landsOnLabel = useBackLandsOn(backTo ?? "/");
  // `gone` is true once a hidden bar's slide out has ended (or it never showed): visibility hidden.
  const [prevShown, setPrevShown] = useState(shown);
  const [gone, setGone] = useState(!shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    if (shown) setGone(false);
  }

  // FLOW-1051: layout effects, so the html offsets the sticky heads read change in the same frame as the bar and its
  // dock row (their transitions start together; in WebKit a later effect let a row show between the two).
  useLayoutEffect(() => {
    if (!shown) return;
    reportShowing(reported, 1);
    return () => {
      reportShowing(reported, -1);
    };
  }, [shown, reported]);

  useLayoutEffect(() => {
    if (!dockOpen) return;
    reportDock(1);
    return () => {
      reportDock(-1);
    };
  }, [dockOpen]);

  // The slide out ends the hiding: the bar is visibility hidden from then on. A native listener, the
  // way the sheet listens for its own slide (sheet.tsx).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (shown || node == null) return;
    const onEnd = (event: AnimationEvent) => {
      if (event.target === node) setGone(true);
    };
    node.addEventListener("animationend", onEnd);
    return () => {
      node.removeEventListener("animationend", onEnd);
    };
  }, [shown]);

  const state = shown ? "m-bar-in" : gone ? "ui-compact-bar-gone" : "m-bar-out";
  const labelled = label != null && label !== "" && landsOnLabel;
  let back: ReactNode = null;
  if (backTo != null) {
    back = labelled ? (
      <button
        type="button"
        className="ui-back-labelled"
        aria-label={`חזרה ל${label}`}
        onClick={() => { goBack(backTo); }}
      >
        <BackIcon />
        <span className="ui-back-text" data-clip-ok="">{label}</span>
      </button>
    ) : (
      <IconButton label="חזרה" onClick={() => { goBack(backTo); }}>
        <BackIcon />
      </IconButton>
    );
  }
  // FLOW-1043: always rendered with a dock, so it can grow and fade; closed, it takes no focus and reads as nothing.
  const dockRow =
    dock == null ? null : (
      <div className="ui-compact-dock" data-open={dockOpen || undefined} aria-hidden={!dockOpen} inert={dockOpen ? undefined : true}>
        <div className="ui-compact-dock-row">{dock}</div>
      </div>
    );
  if (centre != null) {
    // FLOW-364: Home's bar. Its arrows keep the scroll; its centre opens the month drawer.
    return (
      <div
        ref={root}
        className={`ui-compact-bar ui-compact-bar-band ui-compact-bar-${tone === "band-past" ? "band-past" : "band"} ${state}`}
        aria-hidden={!shown}
        inert={shown ? undefined : true}
      >
        <div className="ui-compact-bar-row ui-compact-bar-band-row">
          {start}
          {centre}
          {end}
        </div>
        {dockRow}
      </div>
    );
  }
  return (
    <div
      ref={root}
      className={`ui-compact-bar ui-compact-bar-${size} ${state}`}
      aria-hidden={!shown}
      inert={shown ? undefined : true}
    >
      <div className="ui-compact-bar-row">
        {back}
        {/* The page's h1 is still there; this is its echo. */}
        {/* A long title is cut with an ellipsis; the figure after it always shows whole. */}
        <span className="ui-compact-title t-btn" aria-hidden="true">
          {figureFirst && figure != null ? (
            <span className="ui-compact-figure">
              <bdi dir="ltr">{figure}</bdi>
              {"\u00a0•\u00a0"}
            </span>
          ) : null}
          <span className="ui-compact-title-text" data-clip-ok="">{title}</span>
          {!figureFirst && figure != null ? (
            <span className="ui-compact-figure">
              {"\u00a0·\u00a0"}
              <bdi dir="ltr">{figure}</bdi>
            </span>
          ) : null}
        </span>
        {actions != null ? <div className="ui-compact-actions">{actions}</div> : null}
      </div>
      {panel != null ? <div className="ui-compact-panel">{panel}</div> : null}
      {dockRow}
    </div>
  );
}
