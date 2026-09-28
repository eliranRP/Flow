import type { ReactNode } from "react";
import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

/** One title block for every screen. A back control is for screens that are not tab roots. */
export function ScreenHeader({
  title,
  subtitle,
  backTo,
  action,
  kicker,
  leading,
  trailing,
  size = "default",
  subtitleClassName,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
  /** Replaces the back control. Transaction and Split pass their own icon button. */
  leading?: ReactNode;
  /** Sits on the end of the title row. */
  trailing?: ReactNode;
  /** Compact is the t-title-3 used on a transaction. */
  size?: "default" | "compact";
  subtitleClassName?: string;
}) {
  const start = leading ?? (backTo ? (
    <IconButton label="חזרה" to={backTo}>
      <BackIcon />
    </IconButton>
  ) : null);
  return (
    <header className="ui-page">
      {kicker ? <p className="t-hint">{kicker}</p> : null}
      <div className="ui-page-title-row">
        {start}
        <h1 className={size === "compact" ? "t-title-3" : "t-title-1"}>{title}</h1>
        {trailing ?? action}
      </div>
      {subtitle ? <p className={subtitleClassName ? `t-label mt-4 text-text-secondary ${subtitleClassName}` : "t-label mt-4 text-text-secondary"}>{subtitle}</p> : null}
    </header>
  );
}
