/**
 * A Supabase query that stops its request when `signal` aborts (supabase-js `abortSignal`): a read that React Query cancels no longer downloads
 * its answer (FLOW-1341: the forecast reads, `company_forecast` is 102 KB). A query without the method (a test double) is returned as it is.
 */
export function signalled<T>(query: T, signal?: AbortSignal): T {
  const candidate = query as { abortSignal?: (next: AbortSignal) => T } | null;
  return signal != null && typeof candidate?.abortSignal === "function" ? candidate.abortSignal(signal) : query;
}
