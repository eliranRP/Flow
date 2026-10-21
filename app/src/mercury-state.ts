import type { MercuryStatus } from "@flow/shared";

/**
 * Mercury connections as the status read gives them (FLOW-938, decision 0203): a company may hold several,
 * each with its own key, the accounts it syncs and where each account imports from. Only what the status
 * query needs lives here, because Home's first load reads it; the words for the Mercury page are in
 * mercury-connections.ts, which loads with that page.
 */

export type MercuryAccountKind = "checking" | "savings" | "credit" | "treasury" | "other";

export type MercuryAccount = {
  id: string;
  /** The owner's nickname, else Mercury's name. */
  name: string;
  last4: string | null;
  kind: MercuryAccountKind;
  /** Cents; null when Mercury sent none. */
  balanceCents: number | null;
};

export type MercuryConnection = {
  slot: number;
  /** The organisation's name in Mercury, when known. */
  org: string | null;
  /** False once the key stopped working (a reconnect is needed). */
  keyWorks: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  syncing: boolean;
  importFrom: string | null;
  accounts: MercuryAccount[];
  /** False until the owner picks the accounts (step 3); nothing syncs before that. */
  chosen: boolean;
  /** The accounts that sync (a list from before FLOW-938 is every account). */
  synced: string[];
  /** The accounts the owner left out. */
  skipped: string[];
};

/** All of a company's Mercury connections, with the facts the other screens read off them. */
export type MercuryState = {
  connections: MercuryConnection[];
  /** At least one connection is chosen and its key works. */
  connected: boolean;
  /** "auth" when a connection's key stopped working, else the first connection's error. */
  last_error: string | null;
  last_sync_at: string | null;
  syncing: boolean;
};

export const MERCURY_NONE: MercuryState = { connections: [], connected: false, last_error: null, last_sync_at: null, syncing: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function kindOf(raw: unknown): MercuryAccountKind {
  if (raw === "checking" || raw === "savings" || raw === "credit" || raw === "treasury") return raw;
  return "other";
}

/** The account labels the server stores ([{ id, label, last4, kind, balance_cents }]). */
export function mercuryAccounts(labels: unknown): MercuryAccount[] {
  if (!Array.isArray(labels)) return [];
  const accounts: MercuryAccount[] = [];
  for (const row of labels) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id === "" || accounts.some((account) => account.id === row.id)) continue;
    accounts.push({
      id: row.id,
      name: typeof row.label === "string" && row.label.trim() !== "" ? row.label.trim() : "Mercury",
      last4: typeof row.last4 === "string" && /^[0-9]{4}$/.test(row.last4) ? row.last4 : null,
      kind: kindOf(row.kind),
      balanceCents: typeof row.balance_cents === "number" && Number.isFinite(row.balance_cents) ? row.balance_cents : null,
    });
  }
  return accounts;
}

/** One status row as a connection. */
export function mercuryConnection(row: MercuryStatus): MercuryConnection {
  const accounts = mercuryAccounts(row.account_labels);
  const chosen = row.accounts_chosen === true;
  return {
    slot: row.slot ?? 1,
    org: row.org_label ?? null,
    keyWorks: row.last_error !== "auth",
    lastError: row.last_error,
    lastSyncAt: row.last_sync_at,
    syncing: row.syncing === true,
    importFrom: row.import_from,
    accounts,
    chosen,
    synced: chosen ? (row.sync_account_ids ?? accounts.map((account) => account.id)) : [],
    skipped: row.skip_account_ids ?? [],
  };
}

/** The company's connections, by slot, and the summary the other screens read. */
export function mercuryState(rows: readonly MercuryStatus[]): MercuryState {
  const connections = rows.map(mercuryConnection).sort((left, right) => left.slot - right.slot);
  if (connections.length === 0) return MERCURY_NONE;
  const broken = connections.find((connection) => !connection.keyWorks);
  const stamps = connections.map((connection) => connection.lastSyncAt).filter((at): at is string => at != null).sort();
  return {
    connections,
    connected: connections.some((connection) => connection.chosen && connection.keyWorks),
    last_error: broken ? "auth" : (connections[0]?.lastError ?? null),
    last_sync_at: stamps.at(-1) ?? null,
    syncing: connections.some((connection) => connection.syncing),
  };
}
