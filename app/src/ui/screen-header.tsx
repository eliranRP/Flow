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
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
}) {
  return (
    <header className="ui-page">
      {backTo ? (
        <IconButton label="חזרה" to={backTo}>
          <BackIcon />
        </IconButton>
      ) : null}
      {kicker ? <p className="t-hint">{kicker}</p> : null}
      <div className="ui-page-title-row">
        <h1 className="t-title-1">{title}</h1>
        {action}
      </div>
      {subtitle ? <p className="t-label mt-4 text-text-secondary">{subtitle}</p> : null}
    </header>
  );
}
