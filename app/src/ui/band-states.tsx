// FLOW-958, shared by FLOW-961 and FLOW-963: a page's offline line and failed read (in the band on Home and
// the project page, in the page on קבועים), and the one filled button the review row becomes above a page's
// other rows.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BannerRow } from "./banner";
import { Button } from "./button";
import { cx } from "./cx";
import { AlertIcon } from "./icons";
import { TopBand } from "./top-band";

/** Whether the browser says it is online, kept current. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
  );
}

/** "09:41": a moment's hour and minute, Israel time (the offline line). */
export function israelHourMinute(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" }).format(new Date(at));
}

/**
 * Offline, the page keeps its last figures and says, in the band, which moment they are from. `onPage`
 * (FLOW-963, a page with no band) draws it as a card line and adds that the app is trying again.
 */
export function BandOfflineLine({ since, onPage = false, words }: { onPage?: boolean } & ({ since: number; words?: undefined } | { since?: undefined; words: string })) {
  return (
    <p className={cx("ui-band-offline", onPage && "ui-page-offline")} role="status">
      <AlertIcon size={20} />
      <span className="ui-band-offline-text">
        {/* FLOW-971: a page that says what it still does offline (search) has its own words, with no moment. */}
        {since == null ? (
          <>אין חיבור · {words}</>
        ) : onPage ? (
          // On a narrow page line the moment keeps its "מ־" on its line.
          <>אין חיבור · מוצג המצב <span className="ui-band-offline-time">מ־<bdi dir="ltr">{israelHourMinute(since)}</bdi></span></>
        ) : (
          <>אין חיבור · מוצג המצב מ־<bdi dir="ltr">{israelHourMinute(since)}</bdi></>
        )}
      </span>
      {onPage ? <span className="ui-page-offline-retry">מתחבר מחדש…</span> : null}
    </p>
  );
}

/** What happened, the retry and the way to help (an error never ends on a dead line). Offline reads the network's words. */
function FailedBody({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <>
      <span className="ui-band-failed-icon" aria-hidden="true">
        <AlertIcon size={24} />
      </span>
      <h2 className="ui-band-failed-title">{offline ? "אין חיבור" : title}</h2>
      <p className="ui-band-failed-body">{offline ? "אין חיבור לאינטרנט. שום דבר לא נמחק." : "משהו נשבר אצלנו, לא אצלכם. הנתונים שמורים, ושום דבר לא נמחק."}</p>
      <div className="ui-band-failed-actions">
        <button type="button" className="ui-band-failed-retry m-press" onClick={onRetry}>
          נסו שוב
        </button>
        <Link to="/help" className="ui-band-failed-help m-press">
          צריך עזרה?
        </Link>
      </div>
    </>
  );
}

/**
 * A page's read failed. The band stays and says what happened, with the retry and the way to help
 * (an error never ends on a dead line). Offline reads the network's words.
 */
export function BandLoadFailed({ title, offline, onRetry, leading, trailing }: { title: string; offline: boolean; onRetry: () => void; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <TopBand wordmark={false} leading={leading} trailing={trailing}>
      <div className="ui-band-body ui-band-failed" role="alert">
        <FailedBody title={title} offline={offline} onRetry={onRetry} />
      </div>
    </TopBand>
  );
}

/** FLOW-963: the same failure on a page with no band (קבועים), as a card under the page's title. */
export function PageLoadFailed({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <section className="ui-card ui-page-failed" role="alert">
      <FailedBody title={title} offline={offline} onRetry={onRetry} />
    </section>
  );
}

/** The review row as the page's one filled button: "לאישור 7 פריטים · כ־2 דקות". Null for a row without a button. */
export function ReviewButton({ row }: { row: BannerRow | undefined }) {
  if (row?.button == null) return null;
  return (
    <div className="ui-review-cta">
      <Button full to={row.to} chevron>
        {row.button.label}
        {" "}
        <span className="ui-review-cta-time">· {row.button.hint}</span>
      </Button>
    </div>
  );
}
