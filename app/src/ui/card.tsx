import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type CardProps = Omit<HTMLAttributes<HTMLElement>, "className"> & {
  /** The element to draw: a section for a titled block, a div otherwise. */
  as?: "section" | "div";
  /** `tint` is the problem box and the needs-attention card. */
  tone?: "default" | "tint";
  className?: string;
  children?: ReactNode;
};

/**
 * A focused item or summary on a surface (FLOW-363): radius 20, 16px padding, no border.
 * Flat lists stay on the background without a card.
 */
export function Card({ as = "div", tone = "default", className, children, ...rest }: CardProps) {
  const classes = cx("ui-card", tone === "tint" && "ui-card-tint", className);
  if (as === "section") {
    return (
      <section className={classes} {...rest}>
        {children}
      </section>
    );
  }
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
