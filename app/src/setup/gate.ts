import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";

/**
 * FLOW-1342. What Home's first load knows about setup, so the setup chunk (route.tsx, home.tsx and the
 * modules they share) loads only for a user it matters to. Reads the saved flags as plain JSON and
 * imports nothing from storage.ts, model.ts or store.tsx: those are the chunk.
 */

/** The key storage.ts writes (setupStorageKey); a test holds the two equal. */
export const gateStorageKey = (userId: string, companyId: string) => `flow.setup.${userId}.${companyId}`;

type Flags = Record<string, unknown>;

const stamped = (flags: Flags, key: string) => typeof flags[key] === "string" && flags[key] !== "";

function asFlags(state: unknown): Flags | null {
  return state != null && typeof state === "object" ? (state as Flags) : null;
}

/** A run the one automatic resume may still take: model.ts runMayResume, as plain flags (a test holds them equal). */
export function flagsMayResume(state: unknown): boolean {
  const flags = asFlags(state);
  if (flags == null) return false;
  return stamped(flags, "flow_at") && stamped(flags, "run_started_at")
    && !stamped(flags, "run_resumed_at") && !stamped(flags, "skipped_all_at") && !stamped(flags, "finished_at");
}

/**
 * A run still open on Home: started, not finished or skipped, and the completed toast not shown yet. Only
 * such a run can show the toast, so only it loads home.tsx.
 */
export function flagsOpenForSlot(state: unknown): boolean {
  const flags = asFlags(state);
  if (flags == null) return false;
  return stamped(flags, "run_started_at")
    && !stamped(flags, "skipped_all_at") && !stamped(flags, "finished_at") && !stamped(flags, "completed_toast_at");
}

function localFlags(userId: string, companyId: string): unknown {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(gateStorageKey(userId, companyId));
    return raw == null || raw === "" ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

async function serverFlags(userId: string, companyId: string): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return null;
  const { data, error } = await supabase.from("setup_states").select("state").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { state?: unknown } | null)?.state ?? null;
}

/**
 * Whether the saved flags of this user and company pass `test`. This phone's copy answers at once; with
 * no copy that passes (a new phone, or a run another phone started) the row on the server answers, the
 * one read setup made on a cold start before. A failed read does not pass. Nothing is read until `active`.
 */
export function useSetupFlags(userId: string | null, companyId: string | null, active: boolean, test: (state: unknown) => boolean): boolean {
  const live = active && userId != null && companyId != null;
  const local = live && test(localFlags(userId, companyId));
  const server = useQuery({
    queryKey: ["setup-gate", userId, companyId],
    enabled: live && !local,
    queryFn: () => serverFlags(userId as string, companyId as string),
    staleTime: Infinity,
    retry: false,
  });
  return local || (live && test(server.data));
}
