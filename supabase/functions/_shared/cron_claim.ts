/**
 * A cron drain run that holds a connection claim (FLOW-510). `sync` may return early with
 * `skipped` (quiet gap, another run busy) or throw before its own release runs, so the drain
 * releases the claim itself in those cases. Otherwise Settings shows the connector as syncing,
 * and a manual refresh is skipped, until the 15-minute cutoff.
 */
export async function runWithClaim<T extends { skipped?: boolean }>(
  sync: () => Promise<T>,
  release: () => PromiseLike<unknown>,
): Promise<T> {
  let result: T;
  try {
    result = await sync();
  } catch (error) {
    await releaseQuietly(release);
    throw error;
  }
  if (result.skipped === true) await releaseQuietly(release);
  return result;
}

async function releaseQuietly(release: () => PromiseLike<unknown>): Promise<void> {
  try {
    await release();
  } catch {
    // The claim then lapses at the cutoff, as before.
  }
}
