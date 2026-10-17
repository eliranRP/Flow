import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "react-router-dom";

type SplitPop = (event: PopStateEvent) => void;

/** A capture-phase popstate listener on window; the returned function removes it. */
function listenPopState(handler: SplitPop): () => void {
  window.addEventListener("popstate", handler, true);
  return () => {
    window.removeEventListener("popstate", handler, true);
  };
}

/**
 * Browser back saves a split like ✕ (0075): the first pop of an invalid split is held, and a
 * valid one saves.
 */
export function useSaveOnBack({
  dirty,
  busy,
  leave,
  leaving,
}: {
  dirty: boolean;
  busy: boolean;
  /** Saves a valid split; an invalid one is held once, then discarded. */
  leave: () => Promise<void>;
  /** Set once the screen goes back itself, so its own pop is not held. */
  leaving: RefObject<boolean>;
}): void {
  const location = useLocation();
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const here = `${location.pathname}${location.search}${location.hash}`;
  const hereRef = useRef(here);
  hereRef.current = here;
  const gateRef = useRef({ dirty, busy });
  gateRef.current = { dirty, busy };
  useEffect(() => {
    function onPop(event: PopStateEvent) {
      if (leaving.current) return;
      const gate = gateRef.current;
      if (!gate.dirty && !gate.busy) return;
      event.stopImmediatePropagation();
      window.history.pushState(window.history.state, "", hereRef.current);
      void leaveRef.current();
    }
    return listenPopState(onPop);
  }, [leaving]);
}
