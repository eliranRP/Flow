import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { ChevronIcon } from "./icons";

type TextLinkProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  href?: string;
  tone?: "accent" | "quiet";
  size?: "label" | "hint";
  chevron?: boolean;
};

export function TextLink({ children, className, to, href, tone = "accent", size = "label", chevron = true }: TextLinkProps) {
  const classes = cx("ui-text-link", tone === "quiet" && "ui-text-link-quiet", size === "hint" && "ui-text-link-hint", className);
  const body = (
    <>
      {children}
      {chevron ? <ChevronIcon size={16} /> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <a href={href} className={classes}>
      {body}
    </a>
  );
}
