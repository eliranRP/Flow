import { useCallback, useRef, useState } from "react";
import type { Machine } from "@flow/shared";

/**
 * A component's state as one explicit machine (decision 0266). `send` answers whether the event
 * was allowed in the state the machine is in right now, read from a ref, so two taps in one tick
 * cannot both start a write: the second `send("start")` is false before React has drawn anything.
 */
export function useMachine<S extends string, E extends string>(machine: Machine<S, E>): { state: S; send: (event: E) => boolean } {
  const current = useRef(machine.initial);
  const [state, setState] = useState(machine.initial);
  const send = useCallback((event: E): boolean => {
    if (!machine.can(current.current, event)) return false;
    current.current = machine.next(current.current, event);
    setState(current.current);
    return true;
  }, [machine]);
  return { state, send };
}
