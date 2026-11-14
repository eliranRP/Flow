/**
 * FLOW-978 (decision 0226): removes the transaction-files objects nothing points at any more (a
 * deleted company's, a deleted line's, a removed file's once its 7 days are up) through the Storage
 * API, which deletes the bytes with the row. SQL alone would leave the bytes behind.
 * public.thread_files_to_purge picks them; mercury-sync runs this hourly ({"kind":"purge-files"})
 * with the service role.
 */
import { defineMachine } from "../../../packages/shared/src/machine.ts";

export type PurgeClient = {
  rpc(name: "thread_files_to_purge", args: { p_limit: number }): PromiseLike<{ data: unknown; error: unknown }>;
  rpc(name: "thread_files_purge_skip", args: { p_names: string[]; p_for_good: boolean }): PromiseLike<{ data: unknown; error: unknown }>;
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
 * same rule as public.thread_files_to_purge; a listed name that fails it anyway is skipped (below).
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const THREAD_PATH = new RegExp(`^${UUID}/${UUID}/[^/\\\\]`);
const BAD_PART = /(^|\/)\.{0,2}(\/|$)/;
const isThreadPath = (name: string) => THREAD_PATH.test(name) && !BAD_PART.test(name) && !name.includes("\\");

/**
 * FLOW-1168: one listed name. It is removed, or not: it fails the path rule (skipped: it can never
 * pass), or Storage kept it (held: Storage does not say why, and the reason may pass). Either is
 * recorded (thread_files_purge_skip) and left off the list, so the list moves past it rather than
 * returning it first every hour: a skipped name for a day, a held one for an hour (FLOW-1174).
 */
export const purgeName = defineMachine({
  name: "purgeName",
  initial: "listed",
  final: ["removed", "skipped", "held"],
  states: {
    listed: { removed: "removed", refused: "skipped", kept: "held" },
    removed: {},
    skipped: {},
    held: {},
  },
});

export async function purgeThreadFiles(admin: PurgeClient, bucket: string): Promise<{ removed: number; skipped: number }> {
  let removed = 0;
  let skipped = 0;
  for (let round = 0; round < PURGE_ROUNDS; round += 1) {
    const due = await admin.rpc("thread_files_to_purge", { p_limit: PURGE_BATCH });
    if (due.error) throw new Error("purge_list");
    const listed = Array.isArray(due.data) ? due.data.filter((name): name is string => typeof name === "string") : [];
    if (listed.length === 0) break;
    const state = new Map(listed.map((name) => [name, purgeName.initial]));
    const move = (name: string, event: "removed" | "refused" | "kept") => {
      const from = state.get(name);
      if (from !== undefined) state.set(name, purgeName.next(from, event));
    };
    for (const name of listed) if (!isThreadPath(name)) move(name, "refused");
    const names = listed.filter((name) => state.get(name) === "listed");
    if (names.length > 0) {
      const gone = await admin.storage.from(bucket).remove(names);
      if (gone.error) throw new Error("purge_remove");
      // What Storage says it removed, not what was asked.
      const done = Array.isArray(gone.data) ? gone.data : [];
      for (const row of done) {
        const name = row && typeof row === "object" ? (row as { name?: unknown }).name : undefined;
        if (typeof name === "string") move(name, "removed");
      }
      removed += done.length;
      for (const name of names) move(name, "kept");
    }
    // Before the skip list exists (mercury-sync is deployed before the migration), stop as before:
    // the next hour lists the same names first.
    let noted = true;
    for (const [end, forGood] of [["skipped", true], ["held", false]] as const) {
      const names = listed.filter((name) => state.get(name) === end);
      if (names.length === 0 || !noted) continue;
      const answer = await admin.rpc("thread_files_purge_skip", { p_names: names, p_for_good: forGood });
      noted = !answer.error;
      if (noted) skipped += names.length;
    }
    if (!noted) break;
    if (listed.length < PURGE_BATCH) break;
  }
  return { removed, skipped };
}
