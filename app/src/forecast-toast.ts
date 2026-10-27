import type { ToastInput } from "./ui/toast-layout";

/** Decision 0220: on תזרים צפוי an undo stays 5s and a plain note 4s. */
export const FORECAST_UNDO_MS = 5000;
const FORECAST_NOTE_MS = 4000;

/** A תזרים צפוי toast: under the header (decision 0220), the undo 5s and a note 4s. */
export function forecastToast(input: ToastInput): ToastInput {
  return { durationMs: input.action == null ? FORECAST_NOTE_MS : FORECAST_UNDO_MS, ...input, place: "top" };
}

/** The month's writes run one after another, in the order tapped (a change, then its ביטול). */
export function forecastScope(month: string): string {
  return `month-forecast-${month}`;
}
