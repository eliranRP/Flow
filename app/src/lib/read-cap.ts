/**
 * FLOW-1344: at most MAX_REST_IN_FLIGHT Supabase REST/RPC requests at once. The 0.5 GB database
 * runs out of memory when a cold Home wakes every PostgREST backend together (FLOW-1300), so the
 * rest wait their turn here, first in, first out. Only `/rest/v1/` is capped: auth (token refresh),
 * storage, edge functions and realtime go straight through, so a refresh never waits behind reads.
 * A slot is held until the fetch promise settles (the response headers arrive), not until the body
 * is read. An aborted request that is still queued leaves the queue and rejects with an AbortError
 * without being sent. Nothing is retried.
 */
export const MAX_REST_IN_FLIGHT = 4;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function withReadCap(base?: typeof fetch, max: number = MAX_REST_IN_FLIGHT): typeof fetch {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return (input, init) => {
    const run = base ?? globalThis.fetch;
    if (!urlOf(input).includes("/rest/v1/")) return run(input, init);
    const send = (): Promise<Response> => run(input, init).finally(release);
    if (active < max) {
      active += 1;
      return send();
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
    return new Promise<Response>((resolve, reject) => {
      const turn = (): void => {
        signal?.removeEventListener("abort", leave);
        send().then(resolve, reject);
      };
      const leave = (): void => {
        const at = waiting.indexOf(turn);
        if (at >= 0) waiting.splice(at, 1);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal?.aborted) {
        leave();
        return;
      }
      signal?.addEventListener("abort", leave, { once: true });
      waiting.push(turn);
    });
  };
}
