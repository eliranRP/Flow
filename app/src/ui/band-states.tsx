// FLOW-958, shared by FLOW-961: a band page's offline line and failed read (Home and the project page),
// and the one filled button the review row becomes above a page's other rows.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BannerRow } from "./banner";
import { Button } from "./button";
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

/** Offline, the page keeps its last figures and says, in the band, which moment they are from. */
export function BandOfflineLine({ since }: { since: number }) {
  return (
    <p className="ui-band-offline" role="status">
      <AlertIcon size={20} />
      <span className="ui-band-offline-text">
        אין חיבור · מוצג המצב מ־<bdi dir="ltr">{israelHourMinute(since)}</bdi>
      </span>
    </p>
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
      </div>
    </TopBand>
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
