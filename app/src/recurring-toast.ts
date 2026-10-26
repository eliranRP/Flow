import type { ToastInput } from "./ui/toast-layout";

/** Decision 0213: on קבועים an undo stays 5s and a plain note 4s. */
export const RECURRING_UNDO_MS = 5000;
const RECURRING_NOTE_MS = 4000;

/** A קבועים toast: under the header (decision 0213), the undo 5s and a note 4s. */
export function recurringToast(input: ToastInput): ToastInput {
  return { durationMs: input.action == null ? RECURRING_NOTE_MS : RECURRING_UNDO_MS, ...input, place: "top" };
}
