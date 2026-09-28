import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { InfoIcon } from "./icons";

type BannerProps = {
  title: ReactNode;
  hint?: ReactNode;
  to?: string;
  count?: number;
  tone?: "accent" | "quiet";
};

export function Banner({ title, hint, to, count, tone = "accent" }: BannerProps) {
  const className = cx("ui-banner", "ui-hit", tone === "quiet" && "ui-banner-quiet");
  const body = (
    <>
      {count != null && count > 0 ? <span className="count-badge">{count > 99 ? "99+" : count}</span> : null}
      <span>
        <span className="ui-row-title">{title}</span>
        {hint ? <span className="ui-row-hint block">{hint}</span> : null}
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
    <div className="note ui-notice" role="status">
      <span className={tone === "bad" ? "note-icon note-icon-bad" : "note-icon"}>
        <InfoIcon />
      </span>
      <div>
        <p className="note-title">{title}</p>
        <p className="note-body">{body}</p>
        {extra}
      </div>
    </div>
  );
}

export const Note = Notice;
