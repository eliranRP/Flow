/**
 * FLOW-1344: at most MAX_REST_IN_FLIGHT Supabase REST/RPC requests at once. The 0.5 GB database
 * runs out of memory when a cold Home wakes every PostgREST backend together (FLOW-1300), so the
 * rest wait their turn here, first in, first out. Only `/rest/v1/` is capped: auth (token refresh),
 * storage, edge functions and realtime go straight through, so a refresh never waits behind reads.
 * A slot is held until the fetch promise settles (the response headers arrive), not until the body
 * is read, and also when `run` throws. An aborted request that is still queued leaves the queue and
 * rejects with the signal's reason (an AbortError unless abort() was given another) without being
 * sent. Nothing is retried. supabase-js passes (url, init), so the signal is init's. Wrap this inside
 * withCompanyHeader, so the company header is fixed when a request is issued, not when it is sent.
 */
export const MAX_REST_IN_FLIGHT = 4;

export function withReadCap(run: typeof fetch, max = MAX_REST_IN_FLIGHT): typeof fetch {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return (input, init) => {
    if (!(input as string | URL).toString().includes("/rest/v1/")) return run(input, init);
    const send = (): Promise<Response> =>
      new Promise<Response>((r) => {
        r(run(input, init));
      }).finally(release);
    if (active < max) {
      active++;
      return send();
    }
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const turn = (): void => {
        signal?.removeEventListener("abort", leave);
        send().then(resolve, reject);
      };
      const leave = (): void => {
        const at = waiting.indexOf(turn);
        if (at >= 0) waiting.splice(at, 1);
        reject(signal?.reason as Error);
      };
      if (signal?.aborted) leave();
      else {
        signal?.addEventListener("abort", leave, { once: true });
        waiting.push(turn);
      }
    });
  };
}
