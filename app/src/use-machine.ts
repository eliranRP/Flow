import { useCallback, useRef, useState } from "react";
import type { Machine } from "@flow/shared";

/**
 * A component's state as one explicit machine (decision 0266). `send` answers whether the event
 * was allowed in the state the machine is in right now, read from a ref, so two taps in one tick
 * cannot both start a write: the second `send("start")` is false before React has drawn anything.
 * `from` is the state it opens in (a story's sample, say); it defaults to the machine's `initial`.
 */
export function useMachine<S extends string, E extends string>(machine: Machine<S, E>, from: S = machine.initial): { state: S; send: (event: E) => boolean } {
  const current = useRef(from);
  const [state, setState] = useState(from);
  const send = useCallback((event: E): boolean => {
    if (!machine.can(current.current, event)) return false;
    current.current = machine.next(current.current, event);
    setState(current.current);
    return true;
  }, [machine]);
  return { state, send };
}
