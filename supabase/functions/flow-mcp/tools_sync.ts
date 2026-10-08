// MCP tools: sync_bank starts a bank sync job and get_sync_status reads it. Decision 0102.
// Split out of tools.ts (FLOW-807).

import { MERCURY_SYNC_FUNCTION } from "../_shared/connectors/mercury/capabilities.ts";
import {
  envelopeOf,
  fail,
  ok,
  READ_REFUSED,
  type ToolDefer,
  type ToolInvoke,
  type ToolResult,
  type ToolRpc,
  UUID,
  WRITE_REFUSED,
} from "./tools_args.ts";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000_000 ? value : null;
}

/** The mercury-sync counts as the stored result, or null when the shape is wrong. */
function syncResultOf(payload: Record<string, unknown>): Record<string, unknown> | null {
  const added = countOf(payload.inserted);
  const duplicates = countOf(payload.updated);
  const removed = countOf(payload.removed);
  if (added == null || duplicates == null || removed == null) return null;
  const newest = payload.newest_date;
  if (newest != null && (typeof newest !== "string" || !DATE_ONLY.test(newest))) return null;
  return { added, duplicates, removed, newest_date: newest ?? null };
}

type SyncOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string } };

function syncFailure(code: string, message: string): SyncOutcome {
  return { ok: false, error: { code, message } };
}

async function pullBank(invoke: ToolInvoke): Promise<SyncOutcome> {
  const pulled = await invoke(MERCURY_SYNC_FUNCTION, { force: true });
  if (pulled.status === 429) return syncFailure("unavailable", "retry");
  if (pulled.status === 401) return syncFailure("unavailable", "unavailable");
  const payload = pulled.json != null && typeof pulled.json === "object" && !Array.isArray(pulled.json)
    ? pulled.json as Record<string, unknown>
    : null;
  if (payload?.error === "Mercury is not connected") return syncFailure("not_found", "bank is not connected");
  if (payload?.error === "auth") return syncFailure("refused", "bank key was rejected; reconnect in Settings");
  if (pulled.status === 200 && payload != null) {
    if (payload.skipped === true) return syncFailure("unavailable", "retry");
    if (payload.ok === true) {
      const data = syncResultOf(payload);
      if (data != null) return { ok: true, data };
    }
  }
  return syncFailure("refused", "The bank sync failed.");
}

/** Runs the pull and records the outcome on the job. Never throws. */
async function runSyncJob(jobId: string, rpc: ToolRpc, invoke?: ToolInvoke): Promise<void> {
  let outcome: SyncOutcome;
  try {
    outcome = invoke ? await pullBank(invoke) : syncFailure("unavailable", "unavailable");
  } catch {
    outcome = syncFailure("refused", "The bank sync failed.");
  }
  try {
    await rpc("mcp_sync_bank_finish", { p_job_id: jobId, p_response: outcome });
  } catch {
    // The job stays running and get_sync_status reports it as retry after the stale window.
  }
}

export async function syncStatus(jobId: string, rpc: ToolRpc): Promise<ToolResult> {
  const result = await rpc("mcp_sync_status", { p_job_id: jobId });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  return envelopeOf(result.json, READ_REFUSED);
}

export async function syncBank(
  key: string,
  rpc: ToolRpc,
  invoke?: ToolInvoke,
  defer?: ToolDefer,
): Promise<ToolResult> {
  const begin = await rpc("mcp_sync_bank_begin", { p_idempotency_key: key });
  if (begin.status >= 400) return fail("refused", WRITE_REFUSED);
  const begun = envelopeOf(begin.json);
  if (begun.isError) return begun;
  const state = (begun.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  const jobId = typeof state.job_id === "string" && UUID.test(state.job_id) ? state.job_id : null;
  if (state.state === "replay" && jobId != null) return syncStatus(jobId, rpc);
  // A result stored before jobs existed has no state; it replays as it was.
  if (state.state == null && !("job_id" in state) && "added" in state) return ok(state);
  if (state.state !== "proceed" || jobId == null) return fail("refused", WRITE_REFUSED);
  const work = runSyncJob(jobId, rpc, invoke);
  if (defer) {
    defer(work);
    return ok({ job_id: jobId, state: "running" });
  }
  await work;
  return syncStatus(jobId, rpc);
}
