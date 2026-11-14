// FLOW-1168: a line Jev refused as invalid stops spending a call; the run's lease covers its calls;
// a run that finds nothing to tag leaves the rate gate for the next one.
import { assertEquals } from "jsr:@std/assert@1";
import { machineProblems } from "../../../packages/shared/src/machine.ts";
import { JEV_MODEL, JevError } from "./jev.ts";
import { createTagStore, handleJevTag, jevRun, JEV_TAG_BUDGET_MS, tagWork } from "./jev_tag.ts";
import { answers, categories, company, COMPANY, expense, EXPENSE, memoryStore, projects, tagEnv, txnRow } from "./jev_tag_test_support.ts";

const SECOND = "77777777-7777-4777-8777-777777777777";
const THIRD = "88888888-8888-4888-8888-888888888888";
const quiet = { log: () => {} };

/** A store that records each failure mark with its `refused` flag. */
function marking() {
  const store = memoryStore();
  const marks: [string, boolean][] = [];
  store.markFailed = (_company, id, _model, refused) => {
    marks.push([id, refused === true]);
    return Promise.resolve();
  };
  return { store, marks };
}

const ok = () => Promise.resolve({ model: JEV_MODEL, answers: answers(), usage: null });

Deno.test("a line Jev refused is marked refused when Jev answered another line in the run", async () => {
  const { store, marks } = marking();
  let n = 0;
  const report = await tagWork([company({ mode: "shadow", expenses: [expense(), expense({ id: SECOND })] })], store, () => {
    n += 1;
    return n === 1 ? Promise.reject(new JevError("invalid_request", 400)) : ok();
  }, "jev-test-key", quiet);
  assertEquals(report.failed, 1);
  assertEquals(marks, [[EXPENSE, true]]);
});

Deno.test("a refusal with no answer in the run, or any other failure, is a failure that can pass", async () => {
  const alone = marking();
  await tagWork([company({ mode: "shadow" })], alone.store, () => Promise.reject(new JevError("invalid_request", 422)), "jev-test-key", quiet);
  assertEquals(alone.marks, [[EXPENSE, false]]);

  for (const code of ["rate_limited", "overloaded", "timeout", "unavailable"] as const) {
    const other = marking();
    let n = 0;
    await tagWork([company({ mode: "shadow", expenses: [expense({ id: SECOND }), expense()] })], other.store, () => {
      n += 1;
      return n === 1 ? ok() : Promise.reject(new JevError(code, 503));
    }, "jev-test-key", quiet);
    assertEquals(other.marks, [[EXPENSE, false]], code);
  }
});

Deno.test("a run stopped by a rejected key still marks the refused lines, as failures that can pass", async () => {
  const { store, marks } = marking();
  let n = 0;
  await tagWork([company({ mode: "shadow", expenses: [expense(), expense({ id: SECOND })] })], store, () => {
    n += 1;
    return Promise.reject(new JevError(n === 1 ? "invalid_request" : "unauthorized"));
  }, "jev-test-key", quiet).catch(() => {});
  assertEquals(marks, [[EXPENSE, false]]);
});

Deno.test("the store marks a refusal, and falls back to the old call before the migration", async () => {
  const bodies: unknown[] = [];
  let missing = true;
  const fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (missing && "p_refused" in body) return Promise.resolve(Response.json({ code: "PGRST202" }, { status: 404 }));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const store = createTagStore(fetch, "https://example.supabase.co", "service-test");
  await store.markFailed(COMPANY, EXPENSE, JEV_MODEL, true);
  const base = { p_company: COMPANY, p_transaction: EXPENSE, p_model: JEV_MODEL };
  assertEquals(bodies, [{ ...base, p_refused: true }, base]);
  missing = false;
  bodies.length = 0;
  await store.markFailed(COMPANY, EXPENSE, JEV_MODEL, true);
  await store.markFailed(COMPANY, EXPENSE, JEV_MODEL);
  assertEquals(bodies, [{ ...base, p_refused: true }, base]);
});

Deno.test("no call starts once the lease is lost, and a renewal that fails counts as lost", async () => {
  for (const renew of [() => Promise.resolve(false), () => Promise.reject(new Error("network"))]) {
    let calls = 0;
    const report = await tagWork([company({ mode: "shadow", expenses: [expense(), expense({ id: SECOND })] })], memoryStore(), () => {
      calls += 1;
      return ok();
    }, "jev-test-key", { ...quiet, renew });
    assertEquals(calls, 0);
    assertEquals([report.skipped, report.budget_skipped], [2, 2]);
  }
  let renewals = 0;
  let calls = 0;
  await tagWork([company({ mode: "shadow", expenses: [expense(), expense({ id: SECOND }), expense({ id: THIRD })] })], memoryStore(), () => {
    calls += 1;
    return ok();
  }, "jev-test-key", { ...quiet, renew: () => Promise.resolve(++renewals < 3) });
  assertEquals([renewals, calls], [3, 2]);
});

Deno.test("the budget counts from the lease, so a slow listing leaves less time to tag", async () => {
  let calls = 0;
  const report = await tagWork([company({ mode: "shadow" })], memoryStore(), () => {
    calls += 1;
    return ok();
  }, "jev-test-key", { ...quiet, now: () => 1_000_000, startedAt: 1_000_000 - JEV_TAG_BUDGET_MS + 10_000 });
  assertEquals(calls, 0);
  assertEquals(report.budget_skipped, 1);
});

/** A handler run whose listing returns `lines`; counts Jev calls and lease takes. */
function handlerRun(rateState: { lastAt: number }, lines: () => unknown[], counts: { jev: number; lease: number }) {
  return (now: number) => handleJevTag(new Request("http://local/jev-tag", { method: "POST", headers: { "x-flow-cron": "cron-test" } }), {
    fetch: (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/jev_projects")) return Promise.resolve(Response.json(projects));
      if (url.endsWith("/rpc/jev_take_lease")) {
        counts.lease += 1;
        return Promise.resolve(Response.json(true));
      }
      if (url.endsWith("/rpc/jev_reserve_calls")) return Promise.resolve(Response.json(JSON.parse(String(init?.body)).p_want));
      if (/\/rpc\//.test(url) || (init?.method && init.method !== "GET")) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes("/company_integrations")) {
        return Promise.resolve(Response.json([{ company_id: COMPANY, enabled: true, mode: "shadow", threshold: 0.9 }]));
      }
      if (url.includes("/categories")) return Promise.resolve(Response.json(categories));
      if (url.includes("/transactions")) return Promise.resolve(Response.json(lines()));
      return Promise.resolve(Response.json([]));
    },
    env: tagEnv,
    rateState,
    now: () => now,
    intervalMs: 60_000,
    log: () => {},
    readKey: () => Promise.resolve("jev-test-key"),
    call: () => {
      counts.jev += 1;
      return ok();
    },
  });
}

Deno.test("a run that finds nothing to tag does not spend the rate gate; one that tags does", async () => {
  const rateState = { lastAt: -1 };
  let lines: unknown[] = [];
  const counts = { jev: 0, lease: 0 };
  const run = handlerRun(rateState, () => lines, counts);
  assertEquals((await run(10_000)).status, 200);
  assertEquals(rateState.lastAt, -1);
  lines = [txnRow()];
  assertEquals((await run(11_000)).status, 200);
  assertEquals(counts.jev, 1);
  assertEquals((await run(12_000)).status, 429);
  assertEquals(counts.jev, 1);
});

Deno.test("jevRun: every state is reached and ends", () => {
  assertEquals(machineProblems(jevRun), []);
});

Deno.test("jevRun: a move out of order changes nothing, so the gate is spent only on the way into tagging", () => {
  // Work found before the lease is held, or the gate read before it: no move.
  assertEquals(jevRun.next("leasing", "work"), "leasing");
  assertEquals(jevRun.next("leasing", "open"), "leasing");
  assertEquals(jevRun.next("busy", "taken"), "busy");
  assertEquals(jevRun.next(jevRun.next(jevRun.next("leasing", "taken"), "open"), "work"), "tagging");
  assertEquals(jevRun.next("idle", "work"), "idle");
});
