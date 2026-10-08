import type { ReactNode } from "react";
import { BackButton } from "./back";
import { FocusTitle } from "./focus-title";

type HeaderChrome = {
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
  /** Replaces the back control. Transaction and Split pass their own icon button. */
  leading?: ReactNode;
  /** Sits on the end of the bar. */
  trailing?: ReactNode;
  /** Compact is the t-title-3 used on a transaction. */
  size?: "default" | "compact";
  subtitleClassName?: string;
};

/**
 * A title is required unless the header is only the bar. Stacked puts the title under that bar.
 * With a back or leading control the title stacks by default (FLOW-326, mockups 07 and 14), so it
 * starts on the start side under its kicker. A compact title and `layout="inline"` stay on the bar.
 */
export type ScreenHeaderProps =
  | (HeaderChrome & { title: string; barOnly?: false; layout?: "inline" })
  | (HeaderChrome & { barOnly: true; title?: undefined; layout?: undefined })
  | (HeaderChrome & { layout: "stacked"; title: string; barOnly?: false });

function subtitleClass(extra: string | undefined, stacked: boolean): string {
  if (stacked) return extra ? `t-label ${extra}` : "t-label text-text-secondary";
  return extra ? `t-label mt-4 text-text-secondary ${extra}` : "t-label mt-4 text-text-secondary";
}

/** One title block for every screen. A back control is for screens that are not tab roots. */
export function ScreenHeader(props: ScreenHeaderProps) {
  const {
    subtitle,
    backTo,
    action,
    kicker,
    leading,
    trailing,
    size = "default",
    subtitleClassName,
  } = props;
  const barOnly = props.barOnly === true;
  const title = props.title;
  const start = leading ?? (backTo ? <BackButton fallback={backTo} /> : null);
  const stacked = props.layout === "stacked"
    || (props.layout == null && !barOnly && start != null && size !== "compact");
  const kickerLine = kicker ? <p className="t-hint">{kicker}</p> : null;
  return (
    <header className={stacked ? "ui-page ui-page-stacked" : "ui-page"}>
      {stacked ? null : kickerLine}
      <div className="ui-page-title-row">
        {start}
        {barOnly || stacked || title == null ? null : (
          <FocusTitle className={size === "compact" ? "t-title-3" : "t-title-1"}>{title}</FocusTitle>
        )}
        {trailing ?? action}
      </div>
      {stacked ? kickerLine : null}
      {stacked && title != null ? <FocusTitle className="t-title-1">{title}</FocusTitle> : null}
      {subtitle ? <p className={subtitleClass(subtitleClassName, stacked)}>{subtitle}</p> : null}
    </header>
  );
}
