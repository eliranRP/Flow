import { defineMachine } from "@flow/shared";

/**
 * A form's own save, told by the form itself (an inline error, not a toast): `start` is refused
 * while a save runs, so a second tap sends nothing, and every way a save can end is an event, so
 * the form cannot stay busy.
 *
 * - `done`: the save went through.
 * - `fail`: it did not, and the form says so until the next `start` or `clear`.
 * - `stop`: it ended with nothing of the form's to show (another part already told the user).
 */
export const saveFlow = defineMachine({
  name: "saveFlow",
  initial: "idle",
  states: {
    idle: { start: "saving" },
    saving: { done: "idle", fail: "failed", stop: "idle" },
    failed: { start: "saving", clear: "idle" },
  },
});
