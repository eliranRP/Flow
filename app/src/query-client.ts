import { MutationCache, QueryClient } from "@tanstack/react-query";

/**
 * The books change rarely, so a read stays fresh for 30 minutes and a screen opened again
 * draws from the cache with no read. Fresh data still arrives three ways: a write marks every
 * read stale (below) and refetches its own keys (use-write.ts), a finished bank sync refetches
 * every ledger key (use-sync-settled.ts), and focus refetches them at most every 5 minutes
 * (books-focus.tsx).
 */
export const QUERY_STALE_MS = 30 * 60_000;
/** Kept longer than the freshness window, so a read is not dropped before it goes stale. */
export const QUERY_GC_MS = 60 * 60_000;

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // After any write, every cached read is stale, so the next screen that opens reads again,
    // as it did before the long freshness window. The write's own keys refetch on screen now.
    mutationCache: new MutationCache({
      onSuccess: () => client.invalidateQueries({ refetchType: "none" }),
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: QUERY_STALE_MS,
        gcTime: QUERY_GC_MS,
      },
    },
  });
  return client;
}
