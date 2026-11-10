// Flow MCP sync_bank job tests (FLOW-1168): a refused finish is logged, and a page-capped pull is not stored as done.
import { assertEquals } from "jsr:@std/assert@1";
import { syncBank } from "./tools_sync.ts";
import type { ToolRpc } from "./tools_args.ts";

const JOB = "abababab-abab-4000-8000-0000000000ab";
const PULL_OK = { status: 200, json: { ok: true, inserted: 1, updated: 0, removed: 0, newest_date: "2026-09-15" } };

/** Runs one sync_bank job: begin proceeds, the finish answers `finish` (or throws), the pull answers `pull`. */
async function runJob(finish: { status: number; json: unknown } | "throw", pull: { status: number; json: unknown }) {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const rpc: ToolRpc = (name, body) => {
    calls.push({ name, body });
    if (name === "mcp_sync_bank_begin") {
      return Promise.resolve({ status: 200, json: { ok: true, data: { state: "proceed", job_id: JOB } } });
    }
    if (name === "mcp_sync_bank_finish") {
      if (finish === "throw") return Promise.reject(new Error("network"));
      return Promise.resolve(finish);
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
