import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { ChevronIcon } from "./icons";

type TextLinkProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  href?: string;
  onClick?: () => void;
  tone?: "accent" | "quiet";
  size?: "label" | "hint";
  chevron?: boolean;
  /** Drawn before the words. Categories uses a 16px plus. */
  icon?: ReactNode;
  /** Drawn after the words. Categories uses a chevron that turns when expanded. */
  trailing?: ReactNode;
  expanded?: boolean;
  controls?: string;
  /** The categories footer wraps instead of ellipsizing. */
  wrap?: boolean;
  disabled?: boolean;
};

export function TextLink({
  children,
  className,
  to,
  href,
  onClick,
  tone = "accent",
  size = "label",
  chevron = true,
  icon,
  trailing,
  expanded,
  controls,
  wrap = false,
  disabled = false,
}: TextLinkProps) {
  const classes = cx(
    "ui-text-link",
    tone === "quiet" && "ui-text-link-quiet",
    size === "hint" && "ui-text-link-hint",
    wrap && "ui-text-link-wrap",
    className,
  );
  const body = (
    <>
      {icon}
      <span className="ui-text-link-label">{children}</span>
      {trailing != null ? (
        <span className="ui-chevron-turn" data-open={expanded ? "true" : "false"}>
          {trailing}
        </span>
      ) : chevron ? (
        <ChevronIcon size={16} />
      ) : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-expanded={expanded} aria-controls={controls} disabled={disabled}>
        {body}
      </button>
    );
  }
  return (
    <a href={href} className={classes}>
      {body}
    </a>
  );
}
