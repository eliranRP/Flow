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
  hint?: ReactNode;
  icon?: ReactNode;
};

/**
 * The pending card with one linked row per destination (FLOW-321). One row draws
 * the plain Banner; two or more share one tinted card, each row its own link and
 * accessible name, separated by padding (no hairline, decision 0120).
 */
export function BannerRows({ rows }: { rows: readonly BannerRow[] }) {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const [row] = rows;
    if (!row) return null;
    return <Banner to={row.to} title={row.title} hint={row.hint} icon={row.icon} />;
  }
  return (
    <ul className="ui-banner-rows">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={row.to} className="ui-banner-row ui-hit">
            <span className="ui-banner-icon">{row.icon ?? <InboxIcon />}</span>
            <span className="ui-row-text">
              <span className="ui-row-title" dir="rtl">
                {row.title}
              </span>
              {row.hint ? <span className="ui-row-hint">{row.hint}</span> : null}
            </span>
            <span className="ui-banner-chevron">
              <ChevronIcon />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
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
        <p className="ui-notice-title" dir="rtl">{title}</p>
        <p className="ui-notice-body" dir="rtl">{body}</p>
        {extra}
      </div>
    </div>
  );
}

export const Note = Notice;
