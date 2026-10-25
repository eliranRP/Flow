import { israelToday, shiftDays } from "./ui/date-math";

// FLOW-956: when Home shows last week's card. Home's first load carries only this module; the card
// and its words load in their own chunk.

/** FLOW-956: Sunday to Tuesday (Israel time), last week's Sunday, the week Home's card is about; else null. */
export function cardWeek(today = israelToday()): string | null {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return weekday <= 2 ? shiftDays(today, -weekday - 7) : null;
}

const CARD_HIDDEN_KEY = "flow.weekly-card-hidden";

/** ✕ on the card hides that week's card on this phone; next Sunday's is a new week. */
export function weeklyCardHidden(weekStart: string): boolean {
  try {
    return window.localStorage.getItem(CARD_HIDDEN_KEY) === weekStart;
  } catch {
    return false;
  }
}

export function hideWeeklyCard(weekStart: string): void {
  try {
    window.localStorage.setItem(CARD_HIDDEN_KEY, weekStart);
  } catch {
    // Storage blocked: the card goes for this visit only.
  }
}
