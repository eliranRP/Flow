import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChipKind = "suggested" | "choice" | "selected" | "disabled";

type ChipProps = {
  kind?: ChipKind;
  pressed?: boolean;
  children: ReactNode;
  onClick?: () => void;
};

export function Chip({ kind = "choice", pressed = false, children, onClick }: ChipProps) {
  const resolved = pressed ? "selected" : kind;
  return (
    <button
      type="button"
      className={cx("ui-chip", `ui-chip-${resolved}`)}
      aria-pressed={pressed}
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

export function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="ui-status">
      <span aria-hidden="true">✓</span>
      <span className="ui-chip-label">{children}</span>
    </span>
  );
}
