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
 * A stamp that never clears (storage.ts keeps the later one, withPatch never sets null): the run finished,
 * skipped everything, or took its one resume. On this phone's copy the resume decision is final, so no
 * server read can change it.
 */
function flagsFinal(state: unknown): boolean {
  const flags = asFlags(state);
  if (flags == null) return false;
  return stamped(flags, "finished_at") || stamped(flags, "skipped_all_at") || stamped(flags, "run_resumed_at");
}

function localFlags(userId: string, companyId: string): unknown {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(gateStorageKey(userId, companyId));
    return raw == null || raw === "" ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Rows the gate read, for server-store.ts to take instead of reading the same row again. */
const gateRows = new Map<string, { state: unknown }>();
const rowKey = (userId: string, companyId: string) => `${userId}.${companyId}`;

/** The row the gate read for this key (once), or undefined when it did not read one. */
export function takeGateRow(userId: string, companyId: string): { state: unknown } | undefined {
  const key = rowKey(userId, companyId);
  const row = gateRows.get(key);
  gateRows.delete(key);
  return row;
}

/** Tests reset what the gate kept. */
export function resetGateForTests(): void {
  gateRows.clear();
}

async function serverFlags(userId: string, companyId: string): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return null;
  const { data, error } = await supabase.from("setup_states").select("state").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const state = (data as { state?: unknown } | null)?.state ?? null;
  gateRows.set(rowKey(userId, companyId), { state });
  return state;
}

/**
 * Whether this user's saved flags let the one automatic resume still happen. This phone's copy answers
 * at once: a run it may resume says yes, a finished, skipped or resumed one says no for good (no read).
 * With no such copy (a new phone, or a run another phone started) the row on the server answers, one read,
 * which setup's own store then reuses (takeGateRow). A failed read says no. Nothing is read until `active`.
 */
export function useSetupMayResume(userId: string | null, companyId: string | null, active: boolean): boolean {
  const live = active && userId != null && companyId != null;
  const local = live ? localFlags(userId, companyId) : null;
  const final = flagsFinal(local);
  const yes = !final && flagsMayResume(local);
  const server = useQuery({
    queryKey: ["setup-gate", userId, companyId],
    enabled: live && !final && !yes,
    queryFn: () => serverFlags(userId as string, companyId as string),
    staleTime: Infinity,
    retry: false,
  });
  return yes || (live && !final && flagsMayResume(server.data));
}
