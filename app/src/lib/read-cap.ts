/**
 * FLOW-1344: at most MAX_REST_IN_FLIGHT Supabase REST/RPC reads at once. The 0.5 GB database
 * runs out of memory when a cold Home wakes every PostgREST backend together (FLOW-1300), so the
 * reads wait their turn here, first in, first out. Only `/rest/v1/` reads are capped: auth (token refresh),
 * storage, edge functions and realtime go straight through, so a refresh never waits behind reads.
 * FLOW-1348: so does a write, so a save made while a cold Home drains is not queued behind the reads. A write is
 * a PATCH, PUT or DELETE, a POST to a table (insert, upsert), or an RPC POST whose name starts with a common write
 * verb (WRITE_RPC); every other RPC is a read. An RPC named outside those verbs queues as a read, as it did before.
 * A slot is held until the fetch promise settles (the response headers arrive), not until the body
 * is read, and also when `run` throws. An aborted request that is still queued leaves the queue and
 * rejects with the signal's reason (an AbortError unless abort() was given another) without being
 * sent. A request with no answer REQUEST_TIMEOUT_MS after it was sent (above the database's 8 s statement_timeout)
 * is aborted, so fetch rejects with a TimeoutError and its slot is free again. Nothing is retried. supabase-js
 * passes (url, init), so the signal is init's. Wrap this inside withCompanyHeader, so the company header is
 * fixed when a request is issued, not when it is sent.
 */
export const MAX_REST_IN_FLIGHT = 4;
export const REQUEST_TIMEOUT_MS = 15_000;

const WRITE_RPC = /\/rpc\/(set|undo|save|create|upsert|update|delete|remove)_/;

export function withReadCap(run: typeof fetch, max = MAX_REST_IN_FLIGHT, timeoutMs = REQUEST_TIMEOUT_MS): typeof fetch {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  // Sends one request in the slot it holds. The slot comes back when it ends: an answer, an error, an abort (fetch
  // rejects when the signal aborts) or the time limit, which aborts it too.
  const send = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const ac = new AbortController();
    const signal = init?.signal;
    if (signal?.aborted) ac.abort(signal.reason);
    else
      signal?.addEventListener("abort", () => {
        ac.abort(signal.reason);
      });
    const timer = setTimeout(() => {
      ac.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);
    return new Promise<Response>((r) => {
      r(run(input, { ...init, signal: ac.signal }));
    }).finally(() => {
      clearTimeout(timer);
      release();
    });
  };
  return (input, init) => {
    const url = (input as string | URL).toString();
    const method = init?.method ?? "GET";
    const read = method === "GET" || method === "HEAD" || (method === "POST" && url.includes("/rpc/") && !WRITE_RPC.test(url));
    if (!url.includes("/rest/v1/") || !read) return run(input, init);
    if (active < max) {
      active++;
      return send(input, init);
    }
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const turn = (): void => {
        signal?.removeEventListener("abort", leave);
        send(input, init).then(resolve, reject);
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
