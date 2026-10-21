/**
 * Several Mercury connections per company, and the accounts each one syncs (FLOW-938, decision 0202).
 * Pure: no network, no database. mercury-connect picks the slot a key goes to; mercury-sync scopes each
 * connection's run to the accounts the owner chose and to each account's import start.
 */
import type { AccountLabel, CanonicalLine } from "../types.ts";

/** Mercury connections per company. The database checks the same bound. */
export const MERCURY_MAX_CONNECTIONS = 9;

/** One connection as mercury-sync and mercury-connect read it. */
export interface MercuryConnectionScope {
  slot: number;
  /** Every account the key listed at its last sync or connect. */
  accountIds: string[];
  /** Null: the owner has not chosen yet, so nothing syncs. */
  chosen: boolean;
  /** Null: every listed account (a connection from before FLOW-938 with no list). */
  syncAccountIds: string[] | null;
  importFrom: string | null;
  /** Accounts added after the connection's own start, each with its later start. */
  accountFrom: Record<string, string>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && item.length <= 128 && !ids.includes(item)) ids.push(item);
  }
  return ids;
}

/** The account ids in stored account_labels ([{ id, label, ... }]). */
export function labelIds(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return idList(labels.map((row) => (isRecord(row) ? row.id : null)));
}

/** A connector_connections row, read defensively. */
export function readConnectionScope(row: {
  slot?: unknown;
  account_labels?: unknown;
  accounts_chosen_at?: unknown;
  sync_account_ids?: unknown;
  import_from?: unknown;
  account_from?: unknown;
}): MercuryConnectionScope {
  const accountFrom: Record<string, string> = {};
  if (isRecord(row.account_from)) {
    for (const [id, day] of Object.entries(row.account_from)) {
      if (id.length > 0 && id.length <= 128 && typeof day === "string" && DAY.test(day)) accountFrom[id] = day;
    }
  }
  return {
    slot: typeof row.slot === "number" && Number.isInteger(row.slot) ? row.slot : 1,
    accountIds: labelIds(row.account_labels),
    chosen: typeof row.accounts_chosen_at === "string" && row.accounts_chosen_at.length > 0,
    syncAccountIds: row.sync_account_ids == null ? null : idList(row.sync_account_ids),
    importFrom: typeof row.import_from === "string" && DAY.test(row.import_from) ? row.import_from : null,
    accountFrom,
  };
}

/** The accounts of a connection that sync: its list, or every listed account when it has none. */
export function syncedIds(connection: MercuryConnectionScope): string[] {
  if (!connection.chosen) return [];
  return connection.syncAccountIds ?? connection.accountIds;
}

/**
 * The scope of one connection's run. `synced` are its own synced accounts; `own` adds every other
 * connection's synced accounts, so a transfer between synced accounts is skipped even across
 * connections. `outside` are the accounts any connection lists but no one syncs: a transfer to one of
 * them is money out, hinted to transfers.
 */
export function runScope(
  connection: MercuryConnectionScope,
  all: readonly MercuryConnectionScope[],
): { synced: string[]; own: string[]; outside: string[] } {
  const synced = syncedIds(connection);
  const own = [...new Set(all.flatMap((other) => syncedIds(other)))];
  const listed = [...new Set(all.flatMap((other) => other.accountIds))];
  return { synced, own, outside: listed.filter((id) => !own.includes(id)) };
}

/**
 * Lines dated before their account's own start are left out: an account added after the connection's
 * start (account_from) reads only from its later day. Lines with no account, and accounts with no own
 * start, keep the connection's start, which the fetch and the upsert already apply.
 */
export function withinAccountStart(lines: readonly CanonicalLine[], accountFrom: Record<string, string>): CanonicalLine[] {
  return lines.filter((line) => {
    const account = typeof line.source_account_id === "string" ? line.source_account_id : null;
    const start = account ? accountFrom[account] : undefined;
    return start == null || line.doc_date >= start;
  });
}

/**
 * The PostgREST filter for the stored lines that belong to this connection: their account is one of
 * its accounts, and (for one connection only) a line with no account. Ids that are not plain are left
 * out of the filter; Mercury's are uuids. Null when nothing can match.
 */
export function storedLinesFilter(accountIds: readonly string[], withoutAccount: boolean): string | null {
  const plain = accountIds.filter((id) => ACCOUNT_ID.test(id));
  const parts: string[] = [];
  if (plain.length > 0) parts.push(`provider_meta->>account_id.in.(${plain.join(",")})`);
  if (withoutAccount) parts.push("provider_meta->>account_id.is.null");
  return parts.length === 0 ? null : parts.join(",");
}

/** The account labels as stored: id, label, last 4, kind and balance only. */
export function storedLabels(accounts: readonly AccountLabel[]): AccountLabel[] {
  return accounts.map(({ id, label, last4, kind, balance_cents }) => ({
    id,
    label,
    ...(last4 ? { last4 } : {}),
    ...(kind ? { kind } : {}),
    ...(typeof balance_cents === "number" ? { balance_cents } : {}),
  }));
}

export type SlotChoice =
  | { kind: "replace"; slot: number; accountsChanged: boolean }
  | { kind: "add"; slot: number }
  | { kind: "refused"; code: "already_connected" | "too_many_connections" | "not_found" };

/**
 * Where a validated key goes. A key that lists an account of a connection is that connection's new key
 * (the same organisation). A key for slot N (החלפת מפתח) replaces slot N unless it lists another
 * connection's account. Any other key is a new connection on the next free slot.
 */
export function chooseSlot(
  existing: readonly MercuryConnectionScope[],
  accountIds: readonly string[],
  requested: number | null,
): SlotChoice {
  const overlapping = existing.filter((connection) => connection.accountIds.some((id) => accountIds.includes(id)));
  const changed = (connection: MercuryConnectionScope) =>
    connection.accountIds.length !== accountIds.length || accountIds.some((id) => !connection.accountIds.includes(id));
  if (requested != null) {
    const target = existing.find((connection) => connection.slot === requested);
    if (!target) return { kind: "refused", code: "not_found" };
    if (overlapping.some((connection) => connection.slot !== requested)) return { kind: "refused", code: "already_connected" };
    return { kind: "replace", slot: requested, accountsChanged: changed(target) };
  }
  if (overlapping.length > 1) return { kind: "refused", code: "already_connected" };
  const same = overlapping[0];
  if (same) return { kind: "replace", slot: same.slot, accountsChanged: changed(same) };
  for (let slot = 1; slot <= MERCURY_MAX_CONNECTIONS; slot += 1) {
    if (!existing.some((connection) => connection.slot === slot)) return { kind: "add", slot };
  }
  return { kind: "refused", code: "too_many_connections" };
}
