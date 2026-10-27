/**
 * FLOW-978 (decision 0226): removes the transaction-files objects nothing points at any more (a
 * deleted company's, a deleted line's, a removed file's once its 7 days are up) through the Storage
 * API, which deletes the bytes with the row. SQL alone would leave the bytes behind.
 * public.thread_files_to_purge picks them; mercury-sync runs this hourly ({"kind":"purge-files"})
 * with the service role.
 */
export type PurgeClient = {
  rpc(name: "thread_files_to_purge", args: { p_limit: number }): PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: unknown }> };
  };
};

export const PURGE_BATCH = 500;
/** At most this many batches a run: the next hour takes the rest. */
export const PURGE_ROUNDS = 10;
/** Only a thread file's path, <company uuid>/<line uuid>/<name>, is ever removed. */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const THREAD_PATH = new RegExp(`^${UUID}/${UUID}/[A-Za-z0-9._-]{1,160}$`);

export async function purgeThreadFiles(admin: PurgeClient, bucket: string): Promise<{ removed: number }> {
  let removed = 0;
  for (let round = 0; round < PURGE_ROUNDS; round += 1) {
    const due = await admin.rpc("thread_files_to_purge", { p_limit: PURGE_BATCH });
    if (due.error) throw new Error("purge_list");
    const listed = Array.isArray(due.data) ? due.data.filter((name): name is string => typeof name === "string") : [];
    if (listed.length === 0) break;
    const names = listed.filter((name) => THREAD_PATH.test(name) && !name.includes(".."));
    if (names.length > 0) {
      const gone = await admin.storage.from(bucket).remove(names);
      if (gone.error) throw new Error("purge_remove");
      removed += names.length;
    }
    // A listed path that is not a thread file stays listed, so asking again would return it again.
    if (listed.length < PURGE_BATCH || names.length < listed.length) break;
  }
  return { removed };
}
