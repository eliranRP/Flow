export type ReadSchemas = typeof import("./read-schemas");

let pending: Promise<ReadSchemas> | null = null;

/**
 * FLOW-804: the read schemas, fetched once. BooksProvider starts the fetch on mount, so it runs
 * beside the first read. A failed fetch (offline) is forgotten, and the next read tries again.
 */
export function loadReadSchemas(): Promise<ReadSchemas> {
  if (!pending) {
    const next = import("./read-schemas");
    pending = next;
    next.catch(() => {
      if (pending === next) pending = null;
    });
  }
  return pending;
}
