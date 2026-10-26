import type { ReactNode } from "react";
import { cx } from "./cx";

export type ChipKind = "suggested" | "choice" | "disabled";

type ChipProps = {
  kind?: ChipKind;
  pressed?: boolean;
  /** FLOW-966: one choice of a radiogroup; `pressed` is then its checked state. */
  radio?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function Chip({ kind = "choice", pressed = false, radio = false, children, onClick, className }: ChipProps) {
  const label = typeof children === "string" ? children : undefined;
  return (
    <button
      type="button"
      className={cx("ui-chip", `ui-chip-${kind}`, className)}
      role={radio ? "radio" : undefined}
      aria-checked={radio ? pressed : undefined}
      aria-pressed={radio ? undefined : pressed}
      aria-label={label}
      disabled={kind === "disabled"}
      onClick={onClick}
    >
      {kind === "suggested" ? (
        <span className="ui-chip-spark" aria-hidden="true">
          ✦
        </span>
      ) : null}
      <span className="ui-chip-label" data-clip-ok="">{children}</span>
    </button>
  );
}
