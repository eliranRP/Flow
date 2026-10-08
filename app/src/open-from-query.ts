import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** FLOW-331: the + sheet's quick actions land on a screen with `?new=<what>`. */
export type QuickNew = "project" | "loan";

export function quickNewPath(path: string, search: string, what: QuickNew): string {
  const params = new URLSearchParams(search);
  params.set("new", what);
  return `${path}?${params.toString()}`;
}

/**
 * Opens a screen's "new" sheet once when the URL asks for it with `?new=<what>`, then drops the
 * param (replace), so Back and a reload do not open it again. Waits while `ready` is false.
 */
export function useOpenFromQuery(what: QuickNew, ready: boolean, open: () => void) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("new") === what;
  const done = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!asked || !ready || done.current) return;
    done.current = true;
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
    openRef.current();
  }, [asked, ready, params, setParams]);
}
