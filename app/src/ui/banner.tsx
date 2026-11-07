import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { ChevronIcon, InboxIcon, InfoIcon } from "./icons";

type BannerProps = {
  title: ReactNode;
  hint?: ReactNode;
  to?: string;
  /** Replaces the chevron. The banner itself is not a link when this is set. */
  action?: ReactNode;
  icon?: ReactNode;
  /** One line: the hint sits after the title instead of under it. For a note above a pinned bar. */
  slim?: boolean;
};

/** The one tinted pending card. Hide it when there is nothing to show. */
export function Banner({ title, hint, to, action, icon, slim = false }: BannerProps) {
  const linked = to != null && action == null;
  const className = cx("ui-banner", slim && "ui-banner-slim", linked && "ui-hit");
  const body = (
    <>
      <span className="ui-banner-icon">{icon ?? <InboxIcon />}</span>
      <span className="ui-row-text">
        <span className="ui-row-title" dir="rtl">
          {title}
        </span>
        {hint ? <span className="ui-row-hint">{hint}</span> : null}
      </span>
      {action ??
        (linked ? (
          <span className="ui-banner-chevron">
            <ChevronIcon />
          </span>
        ) : null)}
    </>
  );
  if (linked && to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export type BannerRow = {
  /** Stable React key, and the row's place in the card. */
  id: string;
  to: string;
  title: ReactNode;
  /**
   * FLOW-1097: under 360px an attention card draws, with both set, this one- or two-word title of what is needed
   * and `tag` (a count, an amount or a time) on one line; the link's name stays `title`. Without them the title is cut.
   */
  short?: string;
  tag?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  /** FLOW-958: a box that draws this row as its filled button reads this label; a list ignores it. */
  button?: { label: string; hint: string };
  /**
   * FLOW-1043: what the row counts, e.g. "changes:4" or "unpaid:3:2130000". AttentionCards hides the row while
   * the key it was hidden at is unchanged. A row without one cannot be hidden.
   */
  dismissKey?: string;
};

type NoticeProps = {
  title: string;
  body: string;
  tone?: "neutral" | "bad";
  extra?: ReactNode;
};

export function Notice({ title, body, tone = "neutral", extra }: NoticeProps) {
  return (
    <div className="ui-notice" role="status">
      <span className={tone === "bad" ? "ui-notice-icon ui-notice-icon-bad" : "ui-notice-icon"}>
        <InfoIcon />
      </span>
      <div>
        <p className="ui-notice-title" dir="rtl">{title}</p>
        <p className="ui-notice-body" dir="rtl">{body}</p>
        {extra}
      </div>
    </div>
  );
}
