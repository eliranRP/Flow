import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useSyncExternalStore } from "react";
import { BandOfflineLine, useOnline } from "./band-states";

/** The offline line's words: the read waits, and comes in by itself once the connection is back. */
export const OFFLINE_WAIT_WORDS = "ננסה שוב כשהחיבור יחזור";

/**
 * FLOW-1140: true only while the device is offline (connection.ts) and a read waits for the connection
 * (React Query pauses it). Online this is always false and costs no subscription. A screen's skeleton
 * then gives way to the offline line; when the connection returns the read resumes and the skeleton,
 * then the content, come back by themselves. Outside a query client (a bare story or test) it is false.
 */
export function useWaitingOffline(): boolean {
  const client = useContext(QueryClientContext);
  const online = useOnline();
  const cache = online ? null : (client?.getQueryCache() ?? null);
  const subscribe = useCallback((notify: () => void) => (cache == null ? () => undefined : cache.subscribe(notify)), [cache]);
  return useSyncExternalStore(subscribe, () => cache != null && cache.findAll({ fetchStatus: "paused" }).length > 0);
}

/** A loading place's skeleton while its read waits offline: the app's offline line, in the page's padding. */
export function OfflineWait() {
  return (
    <div className="ui-page-pad">
      <BandOfflineLine onPage retrying={false} words={OFFLINE_WAIT_WORDS} />
    </div>
  );
}
