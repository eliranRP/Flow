/**
 * FLOW-1027: Jev right after a bank sync. The flow-jev-tag job runs every 5 minutes (decision 0124),
 * so a line a manual sync brought in sat in לאישור without a suggestion for up to 5 minutes. A sync
 * that added lines now calls jev-tag itself, after its answer is sent. jev-tag keeps every guard:
 * its lease (a run already going answers busy, and the job picks the lines up next), the daily call
 * cap and the per-line retry wait. A failed call changes nothing the job would not do anyway.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Work that must outlive the response (EdgeRuntime.waitUntil when the runtime has it). */
export type Defer = (work: Promise<unknown>) => void;

type EdgeRuntimeLike = { waitUntil?: (work: Promise<unknown>) => void };

/** EdgeRuntime.waitUntil, or a promise left to run with its failure swallowed. */
export function edgeDefer(): Defer {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  const waitUntil = runtime?.waitUntil;
  if (typeof waitUntil === "function") return (work) => waitUntil.call(runtime, work.catch(() => undefined));
  return (work) => {
    void work.catch(() => undefined);
  };
}

/** A sync that stored new lines gives Jev something to label. */
export function syncAddedLines(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const inserted = (result as { inserted?: unknown }).inserted;
  return typeof inserted === "number" && inserted > 0;
}

/**
 * Asks jev-tag to label open lines now: one company's (a manual sync), or every company's with work
 * (null, after the scheduled refreshes). It signs with the cron secret, as the flow-jev-tag job does:
 * jev-tag takes the new secret key, not the legacy service-role key the sync holds. Resolves to
 * jev-tag's status, or null when it could not be reached. Never throws.
 */
export async function kickJev(
  fetch: Fetch,
  supabaseUrl: string,
  cronSecret: string,
  companyId: string | null,
): Promise<number | null> {
  if (supabaseUrl.trim() === "" || cronSecret.trim() === "") return null;
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/jev-tag`, {
      method: "POST",
      headers: { "x-flow-cron": cronSecret, "content-type": "application/json" },
      body: JSON.stringify(companyId == null ? {} : { company_id: companyId }),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}
