import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { ChevronIcon } from "./icons";

type TextLinkProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  /** Replaces the current history entry. Settings uses it so onboarding does not sit on a sheet entry. */
  replace?: boolean;
  href?: string;
  /** The href is an outside page: it opens in a new tab, and the name says so (FLOW-357). */
  external?: boolean;
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
  /** Replaces the accessible name. The SUMIT retry says "ניסיון חוזר: SUMIT". */
  label?: string;
  /** Keeps the control in place and shows a progress cursor. */
  busy?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function TextLink({
  children,
  className,
  to,
  replace = false,
  href,
  external = false,
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
  label,
  busy = false,
  buttonRef,
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
      <span className="ui-text-link-label" data-clip-ok="">{children}</span>
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
      <Link to={to} replace={replace} className={classes} aria-label={label} aria-busy={busy || undefined}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        ref={buttonRef}
        type="button"
        className={classes}
        onClick={onClick}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={disabled}
      >
        {body}
      </button>
    );
  }
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes} aria-label={label} aria-busy={busy || undefined}>
        {body}
        <span className="sr-only">(נפתח בלשונית חדשה)</span>
      </a>
    );
  }
  return (
    <a href={href} className={classes} aria-label={label} aria-busy={busy || undefined}>
      {body}
    </a>
  );
}
