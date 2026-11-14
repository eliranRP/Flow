import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { machineProblems } from "../../../packages/shared/src/machine.ts";
import { PURGE_BATCH, PURGE_ROUNDS, purgeName, purgeThreadFiles, type PurgeClient } from "./thread_purge.ts";

// Invented ids only.
const A = "0a1b2c3d-0000-4000-8000-000000000001";
const L = "0a1b2c3d-0000-4000-8000-000000000002";

/**
 * A client whose list returns the given batches in turn, then nothing. `skips` is what the skip
 * call recorded; `skip: "missing"` answers it as a function the database does not have yet.
 */
function client(
  batches: unknown[][],
  fail: { list?: boolean; remove?: boolean; keep?: number; skip?: "missing" } = {},
) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const skips: [string[], boolean][] = [];
  let calls = 0;
  const admin = {
    rpc: (name: string, args: { p_limit?: number; p_names?: string[]; p_for_good?: boolean }) => {
      if (name === "thread_files_purge_skip") {
        if (fail.skip === "missing") return Promise.resolve({ data: null, error: { code: "PGRST202" } });
        skips.push([args.p_names ?? [], args.p_for_good === true]);
        return Promise.resolve({ data: args.p_names?.length ?? 0, error: null });
      }
      calls += 1;
      return Promise.resolve(fail.list ? { data: null, error: { message: "x" } } : { data: batches.shift() ?? [], error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          removed.push({ bucket, paths });
          if (fail.remove) return Promise.resolve({ data: null, error: { message: "x" } });
          // Storage answers with the objects it removed; `keep` leaves that many in place.
          return Promise.resolve({ data: paths.slice(fail.keep ?? 0).map((name) => ({ name })), error: null });
        },
      }),
    },
  } as PurgeClient;
  return { admin, removed, skips, calls: () => calls };
}

Deno.test("removes what the database lists, in the bucket it is given", async () => {
  const c = client([[`${A}/${L}/a.jpg`, `${A}/${L}/b.pdf`]]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 2, skipped: 0 });
  assertEquals(c.removed, [{ bucket: "transaction-files", paths: [`${A}/${L}/a.jpg`, `${A}/${L}/b.pdf`] }]);
  assertEquals(c.calls(), 1);
  assertEquals(c.skips, []);
});

Deno.test("nothing listed removes nothing", async () => {
  const c = client([]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 0, skipped: 0 });
  assertEquals(c.removed, []);
});

Deno.test("a full batch asks again; a run stops after its rounds", async () => {
  const full = Array.from({ length: PURGE_BATCH }, (_, i) => `${A}/${L}/${String(i)}.jpg`);
  const c = client(Array.from({ length: PURGE_ROUNDS + 2 }, () => [...full]));
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: PURGE_BATCH * PURGE_ROUNDS, skipped: 0 });
  assertEquals(c.calls(), PURGE_ROUNDS);
});

Deno.test("removes any thread file name, never another kind of path, and skips the others", async () => {
  const ok = [`${A}/${L}/a.jpg`, `${A}/${L}/חשבונית.pdf`, `${A}/${L}/sub/b.jpg`, `${A}/${L}/m-1a2b-scan..pdf`];
  const bad = ["avatars/me.png", `${A}/../x.jpg`, `${A}/${L}/..`, `${A}/${L}/./a.jpg`, `${A}/${L}//a.jpg`, `${A}/${L}/sub/`, `${A}/${L}/a\\b.jpg`];
  const c = client([[...ok, ...bad]]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: ok.length, skipped: bad.length });
  assertEquals(c.removed, [{ bucket: "transaction-files", paths: ok }]);
  // A name that fails the path rule can never pass: it waits a day.
  assertEquals(c.skips, [[bad, true]]);
  assertEquals(c.calls(), 1);
});

// FLOW-1168: a name that can never be removed used to stay first in the list for good.
Deno.test("a full batch of names that fail the path rule is skipped, and the run goes on past it", async () => {
  const stuck = Array.from({ length: PURGE_BATCH }, (_, i) => `avatars/${String(i)}.png`);
  const c = client([stuck, [`${A}/${L}/a.jpg`]]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 1, skipped: PURGE_BATCH });
  assertEquals(c.removed, [{ bucket: "transaction-files", paths: [`${A}/${L}/a.jpg`] }]);
  assertEquals(c.calls(), 2);
});

Deno.test("what Storage kept is skipped, and the run goes on", async () => {
  const full = Array.from({ length: PURGE_BATCH }, (_, i) => `${A}/${L}/${String(i)}.jpg`);
  const c = client([[...full], [`${A}/${L}/last.jpg`]], { keep: 2 });
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: PURGE_BATCH - 2, skipped: 3 });
  // Storage does not say why it kept a name, and the reason may pass: it waits an hour (FLOW-1174).
  assertEquals(c.skips, [[full.slice(0, 2), false], [[`${A}/${L}/last.jpg`], false]]);
  assertEquals(c.calls(), 2);
});

Deno.test("a batch with both kinds records each with its own wait", async () => {
  const c = client([["avatars/me.png", `${A}/${L}/a.jpg`, `${A}/${L}/b.jpg`]], { keep: 1 });
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 1, skipped: 2 });
  assertEquals(c.skips, [[["avatars/me.png"], true], [[`${A}/${L}/a.jpg`], false]]);
});

Deno.test("before the skip list exists, a run stops where it did", async () => {
  const full = Array.from({ length: PURGE_BATCH }, (_, i) => `${A}/${L}/${String(i)}.jpg`);
  const c = client([[...full], [...full]], { keep: 2, skip: "missing" });
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: PURGE_BATCH - 2, skipped: 0 });
  assertEquals(c.calls(), 1);
});

Deno.test("a failed list or remove fails the run", async () => {
  await assertRejects(() => purgeThreadFiles(client([], { list: true }).admin, "transaction-files"), Error, "purge_list");
  await assertRejects(
    () => purgeThreadFiles(client([[`${A}/${L}/a.jpg`]], { remove: true }).admin, "transaction-files"),
    Error,
    "purge_remove",
  );
});

Deno.test("purgeName: every state is reached and ends", () => {
  assertEquals(machineProblems(purgeName), []);
});

Deno.test("purgeName: a late answer does not move a name that already ended", () => {
  // Storage's answer comes after the name was skipped, or a skip after it was removed: no change.
  assertEquals(purgeName.next("skipped", "removed"), "skipped");
  assertEquals(purgeName.next("removed", "kept"), "removed");
  assertEquals(purgeName.next(purgeName.next("listed", "removed"), "kept"), "removed");
  assertEquals(purgeName.next("held", "refused"), "held");
});
