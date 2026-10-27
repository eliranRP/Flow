import { TOP_UNDO_MS } from "./ui/top-toast";

/** What a disconnect waits on: its 5s ביטול. `cancel` is the ביטול; it reports whether it came in time. */
export type UndoHold = { done: Promise<void>; cancel: () => boolean };

/** The error a cancelled hold ends its write with. The page already shows the connection again, so it says nothing. */
export const UNDONE = "undone";

/**
 * Decision 0223: a disconnect is drawn at once and sent after its ביטול runs out, so the key stays on the
 * server for those 5s. Leaving the app ends the wait at once: nobody can tap ביטול any more, and the
 * disconnect should not be lost with the page.
 */
export function holdForUndo(ms = TOP_UNDO_MS): UndoHold {
  let settled = false;
  let finish: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // A ביטול before the write awaits the hold is not an unhandled rejection; the write still sees it.
  done.catch(() => undefined);
  const hidden = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") end();
  };
  const stop = () => {
    clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", hidden);
  };
  const end = () => {
    if (settled) return;
    settled = true;
    stop();
    finish();
  };
  const timer = setTimeout(end, ms);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", hidden);
  return {
    done,
    cancel: () => {
      if (settled) return false;
      settled = true;
      stop();
      fail(new Error(UNDONE));
      return true;
    },
  };
}
