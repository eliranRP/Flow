import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PURGE_BATCH, PURGE_ROUNDS, purgeThreadFiles, type PurgeClient } from "./thread_purge.ts";

// Invented ids only.
const A = "0a1b2c3d-0000-4000-8000-000000000001";
const L = "0a1b2c3d-0000-4000-8000-000000000002";

/** A client whose list returns the given batches in turn, then nothing. */
function client(batches: unknown[][], fail: { list?: boolean; remove?: boolean } = {}) {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  let calls = 0;
  const admin: PurgeClient = {
    rpc: () => {
      calls += 1;
      return Promise.resolve(fail.list ? { data: null, error: { message: "x" } } : { data: batches.shift() ?? [], error: null });
    },
    storage: {
      from: (bucket) => ({
        remove: (paths) => {
          removed.push({ bucket, paths });
          return Promise.resolve({ error: fail.remove ? { message: "x" } : null });
        },
      }),
    },
  };
  return { admin, removed, calls: () => calls };
}

Deno.test("removes what the database lists, in the bucket it is given", async () => {
  const c = client([[`${A}/${L}/a.jpg`, `${A}/${L}/b.pdf`]]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 2 });
  assertEquals(c.removed, [{ bucket: "transaction-files", paths: [`${A}/${L}/a.jpg`, `${A}/${L}/b.pdf`] }]);
  assertEquals(c.calls(), 1);
});

Deno.test("nothing listed removes nothing", async () => {
  const c = client([]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 0 });
  assertEquals(c.removed, []);
});

Deno.test("a full batch asks again; a run stops after its rounds", async () => {
  const full = Array.from({ length: PURGE_BATCH }, (_, i) => `${A}/${L}/${String(i)}.jpg`);
  const c = client(Array.from({ length: PURGE_ROUNDS + 2 }, () => [...full]));
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: PURGE_BATCH * PURGE_ROUNDS });
  assertEquals(c.calls(), PURGE_ROUNDS);
});

Deno.test("removes only thread file paths, never another kind of path", async () => {
  const c = client([[`${A}/${L}/a.jpg`, "avatars/me.png", `${A}/../x.jpg`, `${A}/${L}/sub/b.jpg`, `${A}/${L}/..`]]);
  assertEquals(await purgeThreadFiles(c.admin, "transaction-files"), { removed: 1 });
  assertEquals(c.removed, [{ bucket: "transaction-files", paths: [`${A}/${L}/a.jpg`] }]);
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
