import { assertEquals } from "jsr:@std/assert@1";
import { machineEdges, machineProblems } from "../../../packages/shared/src/machine.ts";
import { refreshRequest, refreshSettle, settleRefresh, type RefreshSettle } from "./refresh_queue.ts";

Deno.test("the refresh request table is sound: every state reached, only finished ends", () => {
  assertEquals(machineProblems(refreshRequest), []);
  assertEquals(
    machineEdges(refreshRequest).map((edge) => `${edge.from} ${edge.event} ${edge.to}`),
    ["queued claim claimed", "claimed requeue queued", "claimed finish finished", "claimed lapse finished"],
  );
});

Deno.test("a run that threw, or found the connection busy, puts its request back", () => {
  assertEquals(refreshSettle("threw"), "requeue");
  assertEquals(refreshSettle({ skipped: true, busy: true }), "requeue");
  assertEquals(refreshRequest.next("claimed", refreshSettle("threw")), "queued");
});

Deno.test("a run that synced, or skipped for a reason a retry cannot change, finishes its request", () => {
  // Synced.
  assertEquals(refreshSettle({}), "finish");
  // Skipped inside the quiet gap, or with no accounts chosen: no `busy`.
  assertEquals(refreshSettle({ skipped: true }), "finish");
  assertEquals(refreshRequest.next("claimed", refreshSettle({ skipped: true })), "finished");
});

type Call = { args: { p_id: number; p_requeue: boolean } } | { fallback: RefreshSettle };

function harness(answer: () => Promise<{ error: { code?: string; message?: string } | null }>) {
  const calls: Call[] = [];
  return {
    calls,
    rpc: (args: { p_id: number; p_requeue: boolean }) => {
      calls.push({ args });
      return answer();
    },
    fallback: {
      requeue: () => {
        calls.push({ fallback: "requeue" });
        return Promise.resolve();
      },
      finish: () => {
        calls.push({ fallback: "finish" });
        return Promise.resolve();
      },
    },
  };
}

Deno.test("settling calls settle_connector_refresh with the move", async () => {
  const run = harness(() => Promise.resolve({ error: null }));
  assertEquals(await settleRefresh(run.rpc, run.fallback, 7, "requeue"), "settled");
  assertEquals(await settleRefresh(run.rpc, run.fallback, 8, "finish"), "settled");
  assertEquals(run.calls, [{ args: { p_id: 7, p_requeue: true } }, { args: { p_id: 8, p_requeue: false } }]);
});

Deno.test("before the migration (no such function) the table fallback makes the same move", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const run = harness(() => Promise.resolve({ error: { code, message: "missing" } }));
    assertEquals(await settleRefresh(run.rpc, run.fallback, 3, "requeue"), "fallback");
    assertEquals(await settleRefresh(run.rpc, run.fallback, 3, "finish"), "fallback");
    assertEquals(run.calls, [
      { args: { p_id: 3, p_requeue: true } },
      { fallback: "requeue" },
      { args: { p_id: 3, p_requeue: false } },
      { fallback: "finish" },
    ]);
  }
});

Deno.test("another error, or a throw, uses no fallback and never throws: the request lapses", async () => {
  const refused = harness(() => Promise.resolve({ error: { code: "P0001", message: "forbidden" } }));
  assertEquals(await settleRefresh(refused.rpc, refused.fallback, 4, "finish"), "failed");
  assertEquals(refused.calls, [{ args: { p_id: 4, p_requeue: false } }]);
  const thrown = harness(() => Promise.reject(new Error("network")));
  assertEquals(await settleRefresh(thrown.rpc, thrown.fallback, 5, "requeue"), "failed");
  assertEquals(thrown.calls, [{ args: { p_id: 5, p_requeue: true } }]);
});
