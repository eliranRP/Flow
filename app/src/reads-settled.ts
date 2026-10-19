import type { QueryClient } from "@tanstack/react-query";

/** The longest the screen preload waits for the first reads, so a hung read never holds it back for good. */
const READS_SETTLED_CAP_MS = 8_000;

/**
 * Runs `run` once no read is in flight (`isFetching() === 0`), or after `capMs` at the latest, so
 * the other screens' code never competes with Home's first reads. Returns a cancel.
 */
export function whenReadsSettle(client: Pick<QueryClient, "isFetching" | "getQueryCache">, run: () => void, capMs = READS_SETTLED_CAP_MS): () => void {
  let done = false;
  let unsubscribe: () => void = () => undefined;
  let cap = 0;
  function finish() {
    if (done) return;
    done = true;
    unsubscribe();
    window.clearTimeout(cap);
    run();
  }
  if (client.isFetching() === 0) {
    finish();
    return () => undefined;
  }
  unsubscribe = client.getQueryCache().subscribe(() => {
    if (client.isFetching() === 0) finish();
  });
  cap = window.setTimeout(finish, capMs);
  return () => {
    done = true;
    unsubscribe();
    window.clearTimeout(cap);
  };
}
