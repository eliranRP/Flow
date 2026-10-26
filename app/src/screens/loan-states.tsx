// FLOW-962 (boards Loans failed, Loans offline): the loans list's and the loan page's failed read and
// offline line, in Home v2's words (FLOW-958), as a card: these pages have no band.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { AlertIcon } from "../ui/icons";

/** Whether the browser says it is online, kept current. */
export function useLoanOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
  );
}

/** "09:41": a moment's hour and minute, Israel time. */
function hourMinute(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jerusalem" }).format(new Date(at));
}

/** Offline, the page keeps its last figures and says which moment they are from. */
export function LoanOfflineLine({ since }: { since: number }) {
  return (
    <p className="ui-loan-offline" role="status">
      <AlertIcon size={20} />
      <span className="ui-loan-offline-text">
        אין חיבור · מוצג המצב מ־<bdi dir="ltr">{hourMinute(since)}</bdi>
      </span>
    </p>
  );
}

/** A read failed: what happened, נסו שוב and צריך עזרה? (an error never ends on a dead line). */
export function LoanLoadFailed({ title, offline, retrying, onRetry }: { title: string; offline: boolean; retrying: boolean; onRetry: () => void }) {
  return (
    <Card className="ui-loan-failed" role="alert">
      <span className="ui-loan-failed-icon" aria-hidden="true">
        <AlertIcon size={24} />
      </span>
      <h2 className="ui-loan-failed-title">{offline ? "אין חיבור" : title}</h2>
      <p className="ui-loan-failed-body">{offline ? "אין חיבור לאינטרנט. שום דבר לא נמחק." : "משהו נשבר אצלנו, לא אצלכם. הנתונים שמורים, ושום דבר לא נמחק."}</p>
      <div className="ui-loan-failed-actions">
        <Button busy={retrying} onClick={onRetry}>נסו שוב</Button>
        <Link to="/help" className="ui-loan-failed-help">צריך עזרה?</Link>
      </div>
    </Card>
  );
}
