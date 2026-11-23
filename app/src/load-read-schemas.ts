export type ReadSchemas = typeof import("./read-schemas");

let pending: Promise<ReadSchemas> | null = null;

/**
 * FLOW-804: the read schemas, fetched once. FLOW-1273: readyClient (every read) and Home's early reads start the
 * fetch with the read, so it runs beside it. A failed fetch (offline) is forgotten, and the next read tries again.
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

/** FLOW-1273: starts the fetch (a read needs it soon) and drops a failure; the read that needs the schemas tries again. */
export function preloadReadSchemas(): void {
  loadReadSchemas().catch(() => undefined);
}
