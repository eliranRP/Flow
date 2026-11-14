// Flow MCP sync_bank job tests (FLOW-1168): a finish that is not stored is tried again, then logged;
// a page-capped pull is stored as not complete; a skipped pull and a rate limit say which they are.
import { assertEquals } from "jsr:@std/assert@1";
import { machineProblems } from "../../../packages/shared/src/machine.ts";
import { syncBank, syncJob } from "./tools_sync.ts";
import type { ToolRpc } from "./tools_args.ts";

const JOB = "abababab-abab-4000-8000-0000000000ab";
const PULL_OK = { status: 200, json: { ok: true, inserted: 1, updated: 0, removed: 0, newest_date: "2026-09-15" } };

type Answer = { status: number; json: unknown } | "throw";

/**
 * Runs one sync_bank job: begin proceeds, the finish answers `finish` (or throws; a list answers
 * each call in turn, the last one repeated), the pull answers `pull`.
 */
async function runJob(finish: Answer | Answer[], pull: { status: number; json: unknown }) {
  const answers = Array.isArray(finish) ? [...finish] : [finish];
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const rpc: ToolRpc = (name, body) => {
    calls.push({ name, body });
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed", job_id: JOB } } });
    }
    if (name === "mcp_sync_bank_finish") {
      const answer = (answers.length > 1 ? answers.shift() : answers[0])!;
      if (answer === "throw") return Promise.reject(new Error("network"));
      return Promise.resolve(answer);
    }
    return Promise.resolve({ status: 500, json: null });
  };
  const deferred: Promise<unknown>[] = [];
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const first = await syncBank("sync-1", rpc, () => Promise.resolve(pull), (work) => {
      deferred.push(work);
    });
    await Promise.all(deferred);
    return { first, calls, logged };
  } finally {
    console.error = realError;
  }
}

Deno.test("a finish the database refuses is logged, not dropped", async () => {
  const refused = { status: 200, json: { ok: false, error: { code: "refused", message: "The write was refused." } } };
  const { first, logged } = await runJob(refused, PULL_OK);
  assertEquals(first.structuredContent, { ok: true, data: { job_id: JOB, state: "running" } });
  assertEquals(logged.length, 1);
});

Deno.test("a finish answered with an HTTP error is logged, not dropped", async () => {
  const { logged } = await runJob({ status: 500, json: null }, PULL_OK);
  assertEquals(logged.length, 1);
});

Deno.test("a finish that throws is logged, not dropped", async () => {
  const { logged } = await runJob("throw", PULL_OK);
  assertEquals(logged.length, 1);
});

Deno.test("a stored finish logs nothing", async () => {
  const { calls, logged } = await runJob({ status: 200, json: { ok: true, data: { job_id: JOB, state: "done" } } }, PULL_OK);
  assertEquals(calls.some((call) => call.name === "mcp_sync_bank_finish"), true);
  assertEquals(logged.length, 0);
});

const finishes = (calls: { name: string; body: Record<string, unknown> }[]) =>
  calls.filter((call) => call.name === "mcp_sync_bank_finish").map((call) => call.body.p_response);
const STORED = { status: 200, json: { ok: true, data: { job_id: JOB, state: "done" } } };

Deno.test("a finish that is not stored is tried once more; stored then, nothing is logged", async () => {
  const { calls, logged } = await runJob([{ status: 503, json: null }, STORED], PULL_OK);
  assertEquals(finishes(calls).length, 2);
  assertEquals(logged.length, 0);
});

Deno.test("a finish the job no longer takes (not_found) is not tried again", async () => {
  const gone = { status: 200, json: { ok: false, error: { code: "not_found", message: "not found" } } };
  const { calls, logged } = await runJob(gone, PULL_OK);
  assertEquals(finishes(calls).length, 1);
  assertEquals(logged.length, 0);
});

Deno.test("a page-capped pull is stored as done and not complete", async () => {
  const capped = { status: 200, json: { ...PULL_OK.json, complete: false } };
  const { calls } = await runJob(STORED, capped);
  assertEquals(finishes(calls), [{
    ok: true,
    data: { added: 1, duplicates: 0, removed: 0, newest_date: "2026-09-15" },
    complete: false,
  }]);
});

Deno.test("a skipped pull reads as busy, a rate limit as rate_limited with its time", async () => {
  const skipped = await runJob(STORED, { status: 200, json: { ok: true, lines: 0, skipped: true } });
  assertEquals(finishes(skipped.calls), [{ ok: false, error: { code: "unavailable", message: "retry", reason: "busy" } }]);
  const limited = await runJob(STORED, { status: 429, json: { error: "rate_limited", retry_at: "2026-11-13T18:00:00.000Z" } });
  assertEquals(finishes(limited.calls), [{
    ok: false,
    error: { code: "unavailable", message: "retry", reason: "rate_limited", retry_at: "2026-11-13T18:00:00.000Z" },
  }]);
  const bare = await runJob(STORED, { status: 429, json: null });
  assertEquals(finishes(bare.calls), [{ ok: false, error: { code: "unavailable", message: "retry", reason: "rate_limited" } }]);
});

Deno.test("syncJob: every state is reached and ends", () => {
  assertEquals(machineProblems(syncJob), []);
});

Deno.test("syncJob: an answer before the pull ended, or after the job ended, changes nothing", () => {
  assertEquals(syncJob.next("pulling", "stored"), "pulling");
  assertEquals(syncJob.next("lost", "stored"), "lost");
  assertEquals(syncJob.next(syncJob.next(syncJob.next("finishing", "refused"), "refused"), "stored"), "lost");
});
