export type SplitPop = (event: PopStateEvent) => void;

let splitPop: SplitPop | null = null;

/**
 * The split screen holds Back while it saves, so its popstate listener must run before the
 * router's. App imports this file, so the listener is on window before the router mounts, even
 * though the split screen itself loads on demand (FLOW-804).
 */
if (typeof window !== "undefined" && !(window as Window & { __flowSplitPop?: boolean }).__flowSplitPop) {
  (window as Window & { __flowSplitPop?: boolean }).__flowSplitPop = true;
  window.addEventListener("popstate", (event) => {
    splitPop?.(event);
  }, true);
}

/** Sets the split screen's handler; the returned function clears it if it is still this one. */
export function holdSplitPop(handler: SplitPop): () => void {
  splitPop = handler;
  return () => {
    if (splitPop === handler) splitPop = null;
  };
}
