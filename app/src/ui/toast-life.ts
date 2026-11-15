import { useCallback, useRef } from "react";
import { defineMachine, type Machine } from "@flow/shared";

/**
 * A toast's phase (decision 0266, FLOW-1167), the one table the provider's `data-phase` shows.
 *
 * - `show` puts a new toast through `measure`, where its place is worked out. `replace` is a show
 *   while a toast is already placed (`pad`, `fade`, `in`): it keeps its phase, and the new toast
 *   takes its place in this frame.
 * - `pad` (the sheet makes room), `fade` (the toast rises in) and `shown` come from the placement.
 *   They move a toast that is on its way in, never one that is leaving: a late fade or pad
 *   callback during the sink leaves it in `out`.
 * - `leave` (the timer, a tap, a swipe, `dismiss`) and `act` (its action button) both end the
 *   toast; from `out` neither does anything, so the action runs once and a leaving toast leaves
 *   once. `cleared` follows the sink.
 */
export const toastLife = defineMachine({
  name: "toastLife",
  initial: "off",
  states: {
    off: { show: "measure" },
    measure: { show: "measure", pad: "pad", fade: "fade", leave: "out", act: "out" },
    pad: { replace: "pad", pad: "pad", fade: "fade", shown: "in", leave: "out", act: "out" },
    fade: { replace: "fade", pad: "pad", shown: "in", leave: "out", act: "out" },
    in: { replace: "in", pad: "pad", shown: "in", leave: "out", act: "out" },
    out: { show: "measure", cleared: "off" },
  },
});

/**
 * The dismiss timer, apart from the phase: a hover, focus or press (held by the `Toast`, which
 * sends one `pause` when the first begins and one `resume` when the last ends) does not depend on
 * how far in the toast is. `arm` starts the timer once the toast is shown (or again for a
 * replacement), `stop` ends it. A `pause` with nothing running, and a `resume` that was not
 * paused, do nothing.
 */
export const toastTimer = defineMachine({
  name: "toastTimer",
  initial: "idle",
  states: {
    idle: { arm: "running", stop: "idle" },
    running: { arm: "running", pause: "paused", stop: "idle" },
    paused: { arm: "running", resume: "running", stop: "idle" },
  },
});

/** Like `useMachine`, for a machine nothing draws: `send` moves it with no render. */
export function useQuietMachine<S extends string, E extends string>(machine: Machine<S, E>): (event: E) => boolean {
  const state = useRef<S>(machine.initial);
  return useCallback((event: E): boolean => {
    if (!machine.can(state.current, event)) return false;
    state.current = machine.next(state.current, event);
    return true;
  }, [machine]);
}
