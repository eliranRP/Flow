import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";

type TextLinkProps = {
  children: ReactNode;
  className?: string;
  to?: string;
  href?: string;
};

export function TextLink({ children, className, to, href }: TextLinkProps) {
  const classes = cx("ui-text-link", className);
  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classes}>
      {children}
    </a>
  );
}
