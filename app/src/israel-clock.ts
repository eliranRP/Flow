import { useEffect, useState } from "react";
import { msUntilNextIsraelDay } from "./sumit-copy";

/** Israel "now" that moves again at the next Israel midnight. */
export function useRefreshingNow(): [number, (next: number) => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setTimeout(() => { setNow(Date.now()); }, msUntilNextIsraelDay(now));
    return () => { window.clearTimeout(id); };
  }, [now]);
  return [now, setNow];
}
