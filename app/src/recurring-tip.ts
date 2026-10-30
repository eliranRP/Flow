// FLOW-987: the one-time tip under the band's קבועים icon (board RecurringConceptB). Seen once on this
// phone: its ✕ or a tap on the icon hides it for good, as the weekly card's ✕ does.

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
