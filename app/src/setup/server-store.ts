import { getSupabase } from "../lib/supabase";
import type { SetupStore } from "./storage";

/**
 * FLOW-506. The setup flags also live in setup_states, one row per owner and company, so a new
 * phone does not restart the run. localStorage stays the copy the screens read synchronously.
 *
 * Every upload first waits for this page load's one read of the row. With no local write before
 * the read answered, the row replaces the local copy. A write made before it answered is merged
 * field by field (the later stamp wins, skips by step), so a phone with a stale copy never wipes
 * flags another phone saved. Uploads for one key run one after another and send the local copy
 * as it is when they run, so the newest object is the last one sent. After a failed read nothing
 * is uploaded for the rest of the page load. Before a company exists nothing is uploaded.
 */

/** The local copy, passed in so this module does not import storage back. */
export type LocalSetupCopy = {
  read: () => SetupStore;
  write: (store: SetupStore) => void;
  parse: (raw: string) => SetupStore;
  isEmpty: (store: SetupStore) => boolean;
  merge: (server: SetupStore, local: SetupStore) => SetupStore;
};

/** Keys whose server read settled in this page load. */
const loaded = new Set<string>();
/** Keys written in this tab before their server read settled, or local flags the row lacks. */
const dirty = new Set<string>();
/** Keys whose server read failed in this page load. */
const failed = new Set<string>();
const reads = new Map<string, Promise<void>>();
const uploads = new Map<string, Promise<void>>();

const serverKey = (userId: string, companyId: string) => `${userId}.${companyId}`;

/** Tests reset the load state between cases. */
export function resetSetupServerForTests(): void {
  loaded.clear();
  dirty.clear();
  failed.clear();
  reads.clear();
  uploads.clear();
}

/** Tests wait for the queued reads and uploads. */
export async function setupUploadsSettled(): Promise<void> {
  await Promise.all([...reads.values(), ...uploads.values()]);
}

async function readRow(userId: string, companyId: string, local: LocalSetupCopy): Promise<void> {
  const key = serverKey(userId, companyId);
  try {
    const supabase = getSupabase();
    if (!supabase || typeof supabase.from !== "function") return;
    const { data, error } = await supabase
      .from("setup_states")
      .select("state")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      failed.add(key);
      return;
    }
    const row = data as { state?: unknown } | null;
    if (row?.state == null) {
      // No row yet: flags this phone kept before FLOW-506 go up once.
      if (!local.isEmpty(local.read())) dirty.add(key);
      return;
    }
    const server = local.parse(JSON.stringify(row.state));
    local.write(dirty.has(key) ? local.merge(server, local.read()) : server);
  } catch {
    failed.add(key);
  } finally {
    loaded.add(key);
  }
}

/** This page load's one read of the row; later calls share it. */
function settle(userId: string, companyId: string, local: LocalSetupCopy): Promise<void> {
  const key = serverKey(userId, companyId);
  const known = reads.get(key);
  if (known) return known;
  const read = readRow(userId, companyId, local);
  reads.set(key, read);
  return read;
}

async function send(userId: string, companyId: string, local: LocalSetupCopy): Promise<void> {
  await settle(userId, companyId, local);
  if (failed.has(serverKey(userId, companyId))) return;
  const supabase = getSupabase();
  if (!supabase || typeof supabase.from !== "function") return;
  const table = supabase.from("setup_states");
  if (typeof table.upsert !== "function") return;
  // updated_at is stamped by the server.
  await table.upsert({ user_id: userId, company_id: companyId, state: local.read() }, { onConflict: "user_id,company_id" });
}

/** Queues an upload of the local copy. Fire and forget: a refused or failed write keeps the local copy. */
export function uploadSetupState(userId: string, companyId: string, local: LocalSetupCopy): void {
  const key = serverKey(userId, companyId);
  if (!loaded.has(key)) dirty.add(key);
  const before = uploads.get(key) ?? Promise.resolve();
  uploads.set(key, before.then(() => send(userId, companyId, local)).catch(() => undefined));
}

/** Settles the local copy from the row, and uploads once when this tab holds flags the row lacks. */
export async function loadSetupState(userId: string, companyId: string, local: LocalSetupCopy): Promise<true> {
  const key = serverKey(userId, companyId);
  const first = !reads.has(key);
  await settle(userId, companyId, local);
  if (first && dirty.has(key) && !uploads.has(key) && !failed.has(key)) uploadSetupState(userId, companyId, local);
  return true;
}
