import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBackLandsOn, useGoBack } from "./back";
import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

export type CompactBarSize = "list" | "detail";

export type CompactBarProps = {
  title: string;
  /** After the title, " · " and the figure (an Amount at list size). Its own LTR run. */
  figure?: ReactNode;
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
};

/** A bar with a panel reports "panel": it is taller than a list or detail bar. */
type Reported = CompactBarSize | "panel";

/**
 * Bars showing, by size. The html element reports the bar it has under it: the page's sticky month
 * heads and scroll padding use the height of the bar (27-compact-header.css).
 */
const showing: Record<Reported, number> = { list: 0, detail: 0, panel: 0 };

function reportShowing(size: Reported, delta: number): void {
  showing[size] = Math.max(0, showing[size] + delta);
  const root = document.documentElement;
  const total = showing.list + showing.detail + showing.panel;
  if (total === 0) root.removeAttribute("data-compact-bar");
  else if (showing.panel > 0) root.setAttribute("data-compact-bar", "panel");
  else root.setAttribute("data-compact-bar", showing.detail > 0 ? "detail" : "list");
}

/**
 * The one compact bar (decision 0156 extended, FLOW-363 3a): Back on the start side, the title
 * centred in one line, an optional figure after it, actions at the end. It stays mounted once a
 * page can show it, so the slide out has something to run on; `shown` drives the classes.
 */
export function CompactBar({ title, figure, label, backTo, size = "list", shown, actions, panel }: CompactBarProps) {
  const reported: Reported = panel != null ? "panel" : size;
  const goBack = useGoBack();
  const landsOnLabel = useBackLandsOn(backTo ?? "/");
  // `gone` is true once a hidden bar's slide out has ended (or it never showed): visibility hidden.
  const [prevShown, setPrevShown] = useState(shown);
  const [gone, setGone] = useState(!shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    if (shown) setGone(false);
  }

  useEffect(() => {
    if (!shown) return;
    reportShowing(reported, 1);
    return () => {
      reportShowing(reported, -1);
    };
  }, [shown, reported]);

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
          <span className="ui-compact-title-text" data-clip-ok="">{title}</span>
          {figure != null ? (
            <span className="ui-compact-figure">
              {"\u00a0·\u00a0"}
              <bdi dir="ltr">{figure}</bdi>
            </span>
          ) : null}
        </span>
        {actions != null ? <div className="ui-compact-actions">{actions}</div> : null}
      </div>
      {panel != null ? <div className="ui-compact-panel">{panel}</div> : null}
    </div>
  );
}
