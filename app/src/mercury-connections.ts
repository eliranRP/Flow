import type { MercuryStatus } from "@flow/shared";
import { formatDisplay, israelToday } from "./ui/date-math";

/**
 * Mercury connections (FLOW-938, decision 0202): a company may hold several, each with its own key,
 * the accounts it syncs and where each account imports from. Pure: the status rows in, words out.
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

/** "Checking ••4821": the name, with the last 4 when the name does not already end in them. */
export function accountName(account: MercuryAccount): string {
  if (account.last4 == null || account.name.includes(account.last4)) return account.name;
  return `${account.name} ••${account.last4}`;
}

/** The grey line under an account in the accounts step. */
export function accountNote(account: MercuryAccount): string {
  switch (account.kind) {
    case "checking": return "עו״ש";
    case "savings": return "חיסכון";
    case "credit": return "כרטיס אשראי";
    case "treasury": return "Mercury Treasury · השקעה";
    default: return "חשבון";
  }
}

/** Treasury starts unchecked, with this line under it. */
export const TREASURY_HINT = "כסף מושקע, לא תזרים של העסק. בדרך כלל לא מסנכרנים.";
/** Under an account unchecked while editing (signal colour). */
export const DROPPED_HINT = "מה שכבר נכנס נשאר. תנועות חדשות לא ייכנסו.";
/** Under an account checked while editing (accent). */
export const ADDED_HINT = "נכנס מהיום, ואם תרצו גם 24 חודשים אחורה.";

/** At connect time checking, savings and card accounts start checked; treasury does not. */
export function defaultSelection(accounts: readonly MercuryAccount[]): string[] {
  return accounts.filter((account) => account.kind !== "treasury").map((account) => account.id);
}

/** Accounts Mercury lists that the owner has not answered yet: neither synced nor left out. */
export function newAccounts(connection: MercuryConnection): MercuryAccount[] {
  if (!connection.chosen) return [];
  return connection.accounts.filter((account) => !connection.synced.includes(account.id) && !connection.skipped.includes(account.id));
}

/** The synced accounts row: their names in grey, and "3 מתוך 5". */
export function syncedSummary(connection: MercuryConnection): { names: string; count: string } {
  const synced = connection.accounts.filter((account) => connection.synced.includes(account.id));
  return {
    names: synced.map((account) => accountName(account)).join(" · "),
    count: `${String(synced.length)} מתוך ${String(connection.accounts.length)}`,
  };
}

/** A connection's name in lists and on its page: the organisation, else its first account. */
export function connectionName(connection: MercuryConnection): string {
  return connection.org ?? (connection.accounts[0] ? accountName(connection.accounts[0]) : "Mercury");
}

/** "סנכרון 4 חשבונות" / "סנכרון חשבון אחד" / "בחרו לפחות חשבון אחד" (disabled). */
export function syncButtonLabel(count: number, editing: boolean): string {
  if (count === 0) return "בחרו לפחות חשבון אחד";
  if (editing) return "שמירה";
  return count === 1 ? "סנכרון חשבון אחד" : `סנכרון ${String(count)} חשבונות`;
}

/** "$48,210" / "−$4,182": the balance beside an account, whole dollars. */
export function balanceText(cents: number | null): string {
  if (cents == null) return "";
  const dollars = Math.round(Math.abs(cents) / 100).toLocaleString("en-US");
  return `${cents < 0 ? "−" : ""}$${dollars}`;
}

/** Where the first import (or a newly added account) starts. */
export type FromChoice = "start" | "year" | "month" | "today" | "date";

/** The server's p_from: "start", or the day. */
export function fromValue(choice: FromChoice, date: string, now = new Date()): string {
  const today = israelToday(now);
  if (choice === "start") return "start";
  if (choice === "year") return `${today.slice(0, 4)}-01-01`;
  if (choice === "month") return `${today.slice(0, 7)}-01`;
  if (choice === "today") return today;
  return date > today ? today : date;
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

/** The month Mercury's history starts: 24 months including this one. */
function historyStart(now: Date): string {
  const today = israelToday(now);
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - 23;
  return `${HE_MONTHS[index % 12] ?? ""} ${String(Math.floor(index / 12))}`;
}

/** The radio rows of the from sheet; editing adds מהיום (the new account's default) first. */
export function fromOptions(editing: boolean, date: string, now = new Date()): Array<{ value: FromChoice; label: string; note: string }> {
  const today = israelToday(now);
  const rows: Array<{ value: FromChoice; label: string; note: string }> = [
    { value: "start", label: "מההתחלה", note: `כל מה שיש ל־Mercury, עד 24 חודשים אחורה (מ${historyStart(now)})` },
    { value: "year", label: "מתחילת השנה", note: `מ־${formatDisplay(`${today.slice(0, 4)}-01-01`)}` },
    { value: "month", label: "מתחילת החודש", note: `מ־${formatDisplay(`${today.slice(0, 7)}-01`)}` },
    { value: "date", label: "מתאריך", note: `מ־${formatDisplay(date)}` },
  ];
  return editing ? [{ value: "today", label: "מהיום", note: "רק תנועות חדשות" }, ...rows] : rows;
}

/** The date row: the choice in accent and one grey line under the title. */
export function fromRow(choice: FromChoice, date: string, now = new Date()): { label: string; note: string } {
  const option = fromOptions(true, date, now).find((row) => row.value === choice);
  const note = choice === "start" ? "בפעם הראשונה זה לוקח כמה דקות" : (option?.note ?? "");
  return { label: option?.label ?? "", note };
}
