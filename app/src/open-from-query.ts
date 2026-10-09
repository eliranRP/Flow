import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

/** FLOW-331: the + sheet's quick actions land on a screen with `?new=<what>`. */
export type QuickNew = "project" | "loan";

export function quickNewPath(path: string, search: string, what: QuickNew): string {
  const params = new URLSearchParams(search);
  params.set("new", what);
  return `${path}?${params.toString()}`;
}

/** History state for a quick action: the page the + sheet sat over. */
export function quickNewState(over: string | undefined): { quickNewOver: string } | undefined {
  return over == null ? undefined : { quickNewOver: over };
}

function quickNewOver(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("quickNewOver" in state)) return null;
  return typeof state.quickNewOver === "string" ? state.quickNewOver : null;
}

/**
 * Opens a screen's "new" sheet once when the URL asks for it with `?new=<what>`, then drops the
 * param (replace), so Back and a reload do not open it again. Waits while `ready` is false.
 * The sheet opens only once the URL is clean: a sheet that pushes a history layer (useSheetHistory)
 * would otherwise push the URL that still says `new`, and Back would not close it. The screen stays
 * mounted under the + sheet, so each later `?new` opens it again. `open` gets `sameEntry` when + was
 * opened over this same page: the sheet then replaces the entry the action left (adopt in
 * useSheetHistory), so one Back closes it and the next leaves the page, with no duplicate entry.
 */
export function useOpenFromQuery(what: QuickNew, ready: boolean, open: (sameEntry: boolean) => void) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const sameEntry = useRef(false);
  const asked = params.get("new") === what;
  const pending = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!asked || !ready || pending.current) return;
    pending.current = true;
    sameEntry.current = quickNewOver(location.state) === location.pathname;
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [asked, ready, params, setParams, location.state, location.pathname]);
  useEffect(() => {
    if (asked || !pending.current) return;
    pending.current = false;
    openRef.current(sameEntry.current);
  }, [asked]);
}
