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
};

/** The one tinted pending card. Hide it when there is nothing to show. */
export function Banner({ title, hint, to, action, icon }: BannerProps) {
  const linked = to != null && action == null;
  const className = cx("ui-banner", linked && "ui-hit");
  const body = (
    <>
      <span className="ui-banner-icon">{icon ?? <InboxIcon />}</span>
      <span className="ui-row-text">
        <span className="ui-row-title" title={typeof title === "string" ? title : undefined}>
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
        <p className="ui-notice-title">{title}</p>
        <p className="ui-notice-body">{body}</p>
        {extra}
      </div>
    </div>
  );
}

export const Note = Notice;
