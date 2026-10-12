import type { ReactNode } from "react";
import { cx } from "./cx";

type StatusDotProps = {
  /** neutral is secondary text, accent the violet text, signal the one warning colour. */
  tone?: "neutral" | "accent" | "signal";
  /** A 6px dot before the words; the dot takes the tone and the words stay secondary. */
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
};

/**
 * A status or a tag on the board (FLOW-363): coloured text or a 6px dot, never a filled chip.
 * The words are role meta (14/400); the colour is the only thing the tone adds.
 */
export function StatusDot({ tone = "neutral", dot = false, icon, children }: StatusDotProps) {
  return (
    <span className={cx("ui-status", `ui-status-${dot ? "neutral" : tone}`)}>
      {dot ? <span className={cx("ui-status-dot", tone !== "neutral" && `ui-status-dot-${tone}`)} aria-hidden="true" /> : null}
      {icon == null ? null : <span className="ui-status-icon">{icon}</span>}
      <span className="t-meta" data-clip-ok="">
        {children}
      </span>
    </span>
  );
}
