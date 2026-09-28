import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { ChevronIcon, InboxIcon, InfoIcon } from "./icons";

type BannerProps = {
  title: ReactNode;
  hint?: ReactNode;
  to?: string;
};

/** The one tinted pending card. Hide it when there is nothing to show. */
export function Banner({ title, hint, to }: BannerProps) {
  const className = cx("ui-banner", "ui-hit");
  const body = (
    <>
      <span className="ui-banner-icon">
        <InboxIcon />
      </span>
      <span className="ui-row-text">
        <span className="ui-row-title">{title}</span>
        {hint ? <span className="ui-row-hint">{hint}</span> : null}
      </span>
      <span className="ui-banner-chevron">
        <ChevronIcon />
      </span>
    </>
  );
  if (to) {
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
      <span className={tone === "bad" ? "ui-note-icon ui-note-icon-bad" : "ui-note-icon"}>
        <InfoIcon />
      </span>
      <div>
        <p className="ui-note-title">{title}</p>
        <p className="ui-note-body">{body}</p>
        {extra}
      </div>
    </div>
  );
}

export const Note = Notice;
