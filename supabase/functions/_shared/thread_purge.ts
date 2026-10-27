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
    from(bucket: string): { remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }> };
  };
};

export const PURGE_BATCH = 500;
/** At most this many batches a run: the next hour takes the rest. */
export const PURGE_ROUNDS = 10;
/**
 * Only a thread file's path is ever removed: <company uuid>/<line uuid>/ and a name of any letters (a
 * Hebrew name, a sub-folder, "scan..pdf"), with no empty, "." or ".." part and no backslash. The
 * same rule as public.thread_files_to_purge, so a listed name is never skipped and left in its place.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const THREAD_PATH = new RegExp(`^${UUID}/${UUID}/[^/\\\\]`);
const BAD_PART = /(^|\/)\.{0,2}(\/|$)/;
const isThreadPath = (name: string) => THREAD_PATH.test(name) && !BAD_PART.test(name) && !name.includes("\\");

export async function purgeThreadFiles(admin: PurgeClient, bucket: string): Promise<{ removed: number }> {
  let removed = 0;
  for (let round = 0; round < PURGE_ROUNDS; round += 1) {
    const due = await admin.rpc("thread_files_to_purge", { p_limit: PURGE_BATCH });
    if (due.error) throw new Error("purge_list");
    const listed = Array.isArray(due.data) ? due.data.filter((name): name is string => typeof name === "string") : [];
    if (listed.length === 0) break;
    const names = listed.filter(isThreadPath);
    if (names.length > 0) {
      const gone = await admin.storage.from(bucket).remove(names);
      if (gone.error) throw new Error("purge_remove");
      // What Storage says it removed, not what was asked.
      removed += Array.isArray(gone.data) ? gone.data.length : 0;
      // A name Storage did not remove would be listed again: the next hour retries it.
      if (!Array.isArray(gone.data) || gone.data.length < names.length) break;
    }
    // A listed path that is not a thread file stays listed, so asking again would return it again.
    if (listed.length < PURGE_BATCH || names.length < listed.length) break;
  }
  return { removed };
}
