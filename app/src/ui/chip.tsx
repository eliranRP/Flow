import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChipKind = "suggested" | "choice" | "selected" | "disabled";

type ChipProps = {
  kind?: ChipKind;
  pressed?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function Chip({ kind = "choice", pressed = false, children, onClick, className }: ChipProps) {
  const resolved = pressed ? "selected" : kind;
  const label = typeof children === "string" ? children : undefined;
  return (
    <button
      type="button"
      className={cx("ui-chip", `ui-chip-${resolved}`, className)}
      aria-pressed={pressed}
      aria-label={label}
      disabled={kind === "disabled"}
      onClick={onClick}
    >
      {resolved === "suggested" ? (
        <span className="ui-chip-spark" aria-hidden="true">
          ✦
        </span>
      ) : null}
      {resolved === "selected" ? <span className="ui-chip-mark" aria-hidden="true">✓</span> : null}
      <span className="ui-chip-label">{children}</span>
    </button>
  );
}

/** A done, read-only status. No checkmark: the word is the status. */
export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="ui-status">
      <span className="ui-chip-label">{children}</span>
    </span>
  );
}
