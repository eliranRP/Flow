/**
 * FLOW-1027: a manual bank sync that brought lines in asks Jev to label them at once (mercury-sync
 * calls jev-tag after its answer). The review card read its Jev suggestions when the sync ended,
 * before Jev answered, so it reads them again a little later. Two reads: most runs end within the
 * first, a long one within the second.
 */
export const JEV_REREAD_MS = [20_000, 60_000] as const;

/** The Jev reads on the review card and its queue. */
export const JEV_KEYS = [["jev-review-queue"], ["jev-review"]] as const;

/** True when a mercury-sync answer stored new lines. */
export function syncInserted(result: unknown): boolean {
  if (result == null || typeof result !== "object" || !("inserted" in result)) return false;
  return typeof result.inserted === "number" && result.inserted > 0;
}

/** Schedules the re-reads after a sync that stored lines. */
export function rereadJevAfterSync(
  result: unknown,
  invalidate: (queryKey: readonly string[]) => unknown,
  schedule: (run: () => void, ms: number) => unknown = (run, ms) => setTimeout(run, ms),
): void {
  if (!syncInserted(result)) return;
  for (const ms of JEV_REREAD_MS) {
    schedule(() => {
      for (const key of JEV_KEYS) void invalidate(key);
    }, ms);
  }
}
