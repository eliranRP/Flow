// FLOW-963: a page without a band (קבועים and its charge page) says it is offline, or that its read
// failed, as Home v2 does in its band (FLOW-958): the offline line under the page's head, and a card with
// what happened, נסו שוב and צריך עזרה? (an error never ends on a dead line).
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "./button";
import { AlertIcon } from "./icons";
import "./css/39-page-states.css";

/** Whether the app thinks it is online, kept current. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
  );
}

/** "09:41": a moment's hour and minute, Israel time. */
export function israelTime(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" }).format(new Date(at));
}

/** Offline with rows on screen: which moment they are from, and that the app is trying again. */
export function PageOfflineLine({ since }: { since: number }) {
  return (
    <p className="ui-page-offline" role="status">
      <AlertIcon size={20} />
      <span className="ui-page-offline-text">
        אין חיבור · מוצג המצב מ־<bdi dir="ltr">{israelTime(since)}</bdi>
      </span>
      <span className="ui-page-offline-retry">מתחבר מחדש…</span>
    </p>
  );
}

/** The page's read failed: what happened, the retry and the way to help. Offline reads the network's words. */
export function PageLoadFailed({ title, offline, onRetry }: { title: string; offline: boolean; onRetry: () => void }) {
  return (
    <section className="ui-card ui-page-failed" role="alert">
      <span className="ui-page-failed-icon" aria-hidden="true">
        <AlertIcon size={24} />
      </span>
      <h2 className="ui-page-failed-title">{offline ? "אין חיבור" : title}</h2>
      <p className="ui-page-failed-body">{offline ? "אין חיבור לאינטרנט. שום דבר לא נמחק." : "משהו נשבר אצלנו, לא אצלכם. הנתונים שמורים, ושום דבר לא נמחק."}</p>
      <div className="ui-page-failed-actions">
        <Button onClick={onRetry}>נסו שוב</Button>
        <Link to="/help" className="ui-page-failed-help m-press">
          צריך עזרה?
        </Link>
      </div>
    </section>
  );
}
