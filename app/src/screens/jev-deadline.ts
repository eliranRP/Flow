/** The one-second deadline the Jev reads share. Re-exported by jev-review.ts. */

/** A hung read gives the card back. Longer than this, the card keeps today's values. */
export const JEV_READ_MS = 1000;

export function abortError(reason?: unknown): Error {
  return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}

export function signalled<T>(query: T, signal?: AbortSignal): T {
  if (signal == null || query == null || typeof query !== "object") return query;
  const candidate = query as { abortSignal?: (next: AbortSignal) => T };
  if (typeof candidate.abortSignal !== "function") return query;
  return candidate.abortSignal(signal);
}

/**
 * One second, no retry. A stall returns `fallback`. The caller's abort still rejects
 * so React Query can drop the read when the card unmounts.
 */
export function withJevDeadline<T>(
  caller: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (caller?.aborted) return Promise.reject(abortError(caller.reason));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, JEV_READ_MS);
  const onCaller = () => {
    controller.abort(caller?.reason);
  };
  caller?.addEventListener("abort", onCaller, { once: true });
  const attempt = work(controller.signal).then(
    (value) => {
      if (caller?.aborted) throw abortError(caller.reason);
      return value;
    },
    (error: unknown) => {
      if (caller?.aborted) throw abortError(error);
      if (controller.signal.aborted) return fallback;
      throw error;
    },
  );
  const deadline = new Promise<T>((resolve, reject) => {
    const settle = () => {
      if (caller?.aborted) reject(abortError(caller.reason));
      else resolve(fallback);
    };
    if (controller.signal.aborted) settle();
    else controller.signal.addEventListener("abort", settle, { once: true });
  });
  return Promise.race([attempt, deadline]).finally(() => {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCaller);
  });
}
