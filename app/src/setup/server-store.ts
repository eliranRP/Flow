import { getSupabase } from "../lib/supabase";
import type { SetupStore } from "./storage";

/**
 * FLOW-506. The setup flags also live in setup_states, one row per owner and company, so a new
 * phone does not restart the run. localStorage stays the copy the screens read synchronously.
 * The server row wins on load, unless this tab wrote before the load settled; then this tab's copy
 * is uploaded. Writes upload the whole object and the last write wins. Before a company exists
 * nothing is uploaded. A failed read or write leaves the local copy, as before.
 */

/** Keys whose server read settled in this page load. */
const loaded = new Set<string>();
/** Keys written in this tab before their server read settled. */
const pending = new Set<string>();
/** Keys whose server read failed in this page load: writes stay local, so a new phone's empty copy never replaces the row. */
const failed = new Set<string>();

const serverKey = (userId: string, companyId: string) => `${userId}.${companyId}`;

/** Tests reset the load state between cases. */
export function resetSetupServerForTests(): void {
  loaded.clear();
  pending.clear();
  failed.clear();
}

/** The local copy, passed in so this module does not import storage back. */
export type LocalSetupCopy = {
  read: () => SetupStore;
  write: (store: SetupStore) => void;
  parse: (raw: string) => SetupStore;
  isEmpty: (store: SetupStore) => boolean;
};

/** Uploads the whole object. Fire and forget: a refused or failed write keeps the local copy. */
export function uploadSetupState(userId: string, companyId: string, store: SetupStore): void {
  if (failed.has(serverKey(userId, companyId))) return;
  if (!loaded.has(serverKey(userId, companyId))) pending.add(serverKey(userId, companyId));
  try {
    const supabase = getSupabase();
    if (!supabase || typeof supabase.from !== "function") return;
    const table = supabase.from("setup_states");
    if (typeof table.upsert !== "function") return;
    void Promise.resolve(
      table.upsert(
        { user_id: userId, company_id: companyId, state: store, updated_at: new Date().toISOString() },
        { onConflict: "user_id,company_id" },
      ),
    ).catch(() => undefined);
  } catch {
    // No client in this build. The local copy still moves the run.
  }
}

/**
 * Reads the server row once per page load and settles the local copy. `local.write` writes
 * localStorage only, so settling never uploads what it just read.
 */
export async function loadSetupState(userId: string, companyId: string, local: LocalSetupCopy): Promise<true> {
  const key = serverKey(userId, companyId);
  if (loaded.has(key)) return true;
  try {
    const supabase = getSupabase();
    if (!supabase || typeof supabase.from !== "function") return true;
    const { data, error } = await supabase
      .from("setup_states")
      .select("state")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      failed.add(key);
      return true;
    }
    const row = data as { state?: unknown } | null;
    if (pending.has(key) || row == null || row.state == null) {
      const current = local.read();
      if (!local.isEmpty(current)) {
        loaded.add(key);
        uploadSetupState(userId, companyId, current);
      }
      return true;
    }
    local.write(local.parse(JSON.stringify(row.state)));
    return true;
  } catch {
    failed.add(key);
    return true;
  } finally {
    loaded.add(key);
    pending.delete(key);
  }
}
