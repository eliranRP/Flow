import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * FLOW-327. A screen's repeated action, pinned at the bottom: `tabbar` sits on top of the tab bar,
 * `edge` sits on the screen edge with the safe area. The content scrolls above it, and the
 * screen's toasts sit just above it (`data-toast-floor`, decision 0135).
 */
export function ActionBar({
  children,
  place = "tabbar",
  label,
  className,
}: {
  children: ReactNode;
  place?: "tabbar" | "edge";
  /** Names the bar as a group. Leave it out when the buttons name themselves. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cx("ui-action-bar", className)}
      data-place={place}
      data-toast-floor=""
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** A row of two actions inside the bar, 50/50: the secondary at the start, the quiet one at the end. */
export function ActionBarRow({ children }: { children: ReactNode }) {
  return <div className="ui-action-bar-row">{children}</div>;
}
