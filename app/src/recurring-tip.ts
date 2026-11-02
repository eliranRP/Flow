import { type RefObject, useEffect } from "react";
import { useRecurringScheduleQuery } from "./recurring-schedule";

// FLOW-987: the one-time tip under the band's קבועים icon (board RecurringConceptB). Seen once on this
// phone: its ✕, a tap on the icon, a tap anywhere else or a scroll hides it for good (FLOW-1015).

const TIP_SEEN_KEY = "flow.recurring-tip-seen";

export function recurringTipSeen(): boolean {
  try {
    return window.localStorage.getItem(TIP_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRecurringTipSeen(): void {
  try {
    window.localStorage.setItem(TIP_SEEN_KEY, "1");
  } catch {
    // Storage blocked: the tip goes for this visit only.
  }
}

/**
 * FLOW-1015: whether the tip is for this owner. "קבועים עברו לכאן" speaks to an owner who had the tab, and the
 * client keeps no account age, so the sign is the owner's recurring rows: with some, the tab had something to
 * show. An owner with none never had it, so the tip is marked seen and the schedule is not read again. Read only
 * while the tip is unseen and `active` (live Home); a failed read shows nothing and asks again next time.
 */
export function useReturningRecurringOwner(active: boolean): boolean {
  const unseen = active && !recurringTipSeen();
  const schedule = useRecurringScheduleQuery(unseen);
  const rows = unseen ? schedule.data : undefined;
  useEffect(() => {
    if (rows != null && rows.length === 0) markRecurringTipSeen();
  }, [rows]);
  return rows != null && rows.length > 0;
}

/** FLOW-1015: while the tip is open, a press outside it or a scroll anywhere closes it; the press still reaches its control. */
export function useTipDismiss(open: boolean, tip: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && tip.current?.contains(event.target)) return;
      close();
    };
    const scroll = () => { close(); };
    document.addEventListener("pointerdown", press, true);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", press, true);
      window.removeEventListener("scroll", scroll, { capture: true });
    };
  }, [open, tip, close]);
}
