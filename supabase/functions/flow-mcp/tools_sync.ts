// MCP tools: sync_bank starts a bank sync job and get_sync_status reads it. Decision 0102.
// Split out of tools.ts (FLOW-807).

import { defineMachine } from "../../../packages/shared/src/machine.ts";
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

/**
 * What the job stores. `complete` sits beside `data` (false: the pull stopped at its page cap and the
 * next sync brings the rest); a failure asked to retry says why in `reason` (FLOW-1168).
 */
type SyncOutcome =
  | { ok: true; data: Record<string, unknown>; complete?: boolean }
  | { ok: false; error: { code: string; message: string; reason?: "busy" | "rate_limited"; retry_at?: string } };

function syncFailure(code: string, message: string): SyncOutcome {
  return { ok: false, error: { code, message } };
}

/** Asked to retry, and why: busy (the bank sync ran a moment ago or is running) or rate_limited. */
function syncRetry(reason: "busy" | "rate_limited", retryAt?: unknown): SyncOutcome {
  const at = typeof retryAt === "string" && !Number.isNaN(Date.parse(retryAt)) ? { retry_at: retryAt } : {};
  return { ok: false, error: { code: "unavailable", message: "retry", reason, ...at } };
}

async function pullBank(invoke: ToolInvoke): Promise<SyncOutcome> {
  const pulled = await invoke(MERCURY_SYNC_FUNCTION, { force: true });
  const payload = pulled.json != null && typeof pulled.json === "object" && !Array.isArray(pulled.json)
    ? pulled.json as Record<string, unknown>
    : null;
  if (pulled.status === 429) return syncRetry("rate_limited", payload?.retry_at);
  if (pulled.status === 401) return syncFailure("unavailable", "unavailable");
  if (payload?.error === "Mercury is not connected") return syncFailure("not_found", "bank is not connected");
  if (payload?.error === "auth") return syncFailure("refused", "bank key was rejected; reconnect in Settings");
  if (pulled.status === 200 && payload != null) {
    if (payload.skipped === true) return syncRetry("busy");
    if (payload.ok === true) {
      const data = syncResultOf(payload);
      if (data != null) return typeof payload.complete === "boolean" ? { ok: true, data, complete: payload.complete } : { ok: true, data };
    }
  }
  return syncFailure("refused", "The bank sync failed.");
}

/**
 * FLOW-1168: a job's end. The finish is the only write that ends it; one that is not stored (an
 * HTTP error, a throw, a refusal) is tried once more. `not_found` means the job is no longer this
 * run's to end (it ended, or it is past its 5 minutes and reads as failed with reason unknown).
 * A finish lost twice leaves the job running until those 5 minutes, then failed, reason unknown.
 */
export const syncJob = defineMachine({
  name: "syncJob",
  initial: "pulling",
  final: ["stored", "ended", "lost"],
  states: {
    pulling: { pulled: "finishing" },
    finishing: { stored: "stored", gone: "ended", refused: "retrying" },
    retrying: { stored: "stored", gone: "ended", refused: "lost" },
    stored: {},
    ended: {},
    lost: {},
  },
});

async function finishOnce(jobId: string, rpc: ToolRpc, outcome: SyncOutcome): Promise<"stored" | "gone" | "refused"> {
  try {
    const finished = await rpc("mcp_sync_bank_finish", { p_job_id: jobId, p_response: outcome });
    if (finished.status >= 400) return "refused";
    const answer = envelopeOf(finished.json);
    if (!answer.isError) return "stored";
    const code = (answer.structuredContent as { error: { code: string } }).error.code;
    return code === "not_found" ? "gone" : "refused";
  } catch {
    return "refused";
  }
}

/** Runs the pull and records the outcome on the job. Never throws. */
async function runSyncJob(jobId: string, rpc: ToolRpc, invoke?: ToolInvoke): Promise<void> {
  let outcome: SyncOutcome;
  try {
    outcome = invoke ? await pullBank(invoke) : syncFailure("unavailable", "unavailable");
  } catch {
    outcome = syncFailure("refused", "The bank sync failed.");
  }
  let state = syncJob.next(syncJob.initial, "pulled");
  while (state === "finishing" || state === "retrying") {
    state = syncJob.next(state, await finishOnce(jobId, rpc, outcome));
  }
  if (state === "lost") console.error("sync_bank finish not stored twice; the job reads as failed (unknown) after 5 minutes");
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
