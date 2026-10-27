import { useSyncExternalStore } from "react";

/**
 * Decision 0223: disconnecting Mercury or SUMIT is drawn at once and sent only when its ביטול toast
 * closes, so the key stays on the server until then. The waits live here, outside any screen: a page
 * that unmounts and mounts again still draws the connection as leaving, and the write still goes out.
 */
export type ConnectorProvider = "sumit" | "mercury";

/** SUMIT has one connection; Mercury's are numbered by slot. */
export const SUMIT_SLOT = 0;

/** What a page hands over at the tap: how to send the disconnect, and what to do after it. */
export type DisconnectJob = {
  provider: ConnectorProvider;
  slot: number;
  /** The company the disconnect is for, so a replay after a reload goes to the same company. */
  companyId: string | null;
  send: () => Promise<void>;
  onSent?: () => void;
  onFailed?: (error: Error) => void;
};

/** A disconnect waiting on its ביטול. */
export type DisconnectHold = {
  /** ביטול: true when it came in time and nothing was sent. */
  cancel: () => boolean;
  /** Sends now (the toast closed, the app was left, a reconnect needs it out of the way). */
  end: () => Promise<void>;
  /** Runs when the wait ends without a ביטול, so the page can take its toast away. */
  onEnd: (run: () => void) => void;
};

type Entry = { job: DisconnectJob; at: number; sending: Promise<void> | null; ended: Array<() => void> };

const STORAGE_KEY = "flow.pending-disconnects";
/** A disconnect saved before a reload is sent on the next start only if it is this fresh. */
export const REPLAY_MS = 2 * 60 * 1000;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const snapshots = new Map<ConnectorProvider, ReadonlySet<number>>();

function keyOf(provider: ConnectorProvider, slot: number): string {
  return `${provider}:${String(slot)}`;
}

function changed() {
  snapshots.clear();
  save();
  for (const listener of listeners) listener();
}

type Saved = { provider: ConnectorProvider; slot: number; companyId: string | null; at: number };

function isSaved(item: unknown): item is Saved {
  if (typeof item !== "object" || item == null) return false;
  const row = item as Record<string, unknown>;
  return (row.provider === "sumit" || row.provider === "mercury") && typeof row.slot === "number" && typeof row.at === "number"
    && (row.companyId === null || typeof row.companyId === "string");
}

function readSaved(): Saved[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw == null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isSaved) : [];
  } catch {
    return [];
  }
}

function writeSaved(list: Saved[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage can be off (private mode); the wait still works while the app stays open.
  }
}

/** The waits on disk are this tab's waits: a reload replays what is left (replayDisconnects). */
function save() {
  writeSaved([...entries.values()].map(({ job, at }) => ({ provider: job.provider, slot: job.slot, companyId: job.companyId, at })));
}

/** Takes this wait out, unless a newer wait on the same connection has replaced it. */
function remove(key: string, entry: Entry) {
  if (entries.get(key) !== entry) return;
  entries.delete(key);
  changed();
}

function send(key: string, entry: Entry): Promise<void> {
  if (entry.sending) return entry.sending;
  // Set before the end callbacks run: one of them closes the toast, whose onClose ends this wait again.
  entry.sending = entry.job.send().then(
    () => { remove(key, entry); entry.job.onSent?.(); },
    (error: unknown) => { remove(key, entry); entry.job.onFailed?.(error instanceof Error ? error : new Error("failed")); },
  );
  changed();
  for (const run of entry.ended.splice(0)) run();
  return entry.sending;
}

// Leaving the app ends every wait at once: nobody can tap ביטול any more.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const [key, entry] of [...entries]) void send(key, entry);
  });
}

/** Starts a disconnect's wait. A newer wait on the same connection takes the older one's place. */
export function startDisconnect(job: DisconnectJob): DisconnectHold {
  const key = keyOf(job.provider, job.slot);
  const entry: Entry = { job, at: Date.now(), sending: null, ended: [] };
  entries.set(key, entry);
  changed();
  return {
    cancel: () => {
      if (entries.get(key) !== entry || entry.sending) return false;
      remove(key, entry);
      return true;
    },
    end: () => (entries.get(key) === entry || entry.sending ? send(key, entry) : Promise.resolve()),
    onEnd: (run) => { if (entry.sending) run(); else entry.ended.push(run); },
  };
}

/** Sends every wait of a provider now and waits for them, so a new key is not deleted by an old disconnect. */
export async function flushDisconnects(provider: ConnectorProvider): Promise<void> {
  await Promise.all([...entries].filter(([, entry]) => entry.job.provider === provider).map(([key, entry]) => send(key, entry)));
}

/** Drops every wait of a provider without sending (the owner became a viewer, who cannot disconnect). */
export function cancelDisconnects(provider: ConnectorProvider): void {
  for (const [key, entry] of [...entries]) {
    if (entry.job.provider === provider && !entry.sending) remove(key, entry);
  }
}

function leavingOf(provider: ConnectorProvider): ReadonlySet<number> {
  const known = snapshots.get(provider);
  if (known) return known;
  const next: ReadonlySet<number> = new Set([...entries.values()].filter((entry) => entry.job.provider === provider).map((entry) => entry.job.slot));
  snapshots.set(provider, next);
  return next;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The provider's connections that are leaving: waiting on ביטול, or being sent. */
export function useLeavingSlots(provider: ConnectorProvider): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => leavingOf(provider), () => leavingOf(provider));
}

/**
 * Sends the disconnects a reload or a closed app left behind, when they are under 2 minutes old and for
 * this company; older ones are dropped. A wait still live in this tab is not replayed.
 */
export function replayDisconnects(companyId: string | null, sendSaved: (provider: ConnectorProvider, slot: number) => Promise<void>): void {
  const saved = readSaved();
  if (saved.length === 0) return;
  const now = Date.now();
  const live = new Set(entries.keys());
  const left = saved.filter((item) => !live.has(keyOf(item.provider, item.slot)));
  // What is not live and not this company's stays on disk for that company; stale ones go.
  const keep = saved.filter((item) => live.has(keyOf(item.provider, item.slot)) || (item.companyId !== companyId && now - item.at < REPLAY_MS));
  writeSaved(keep);
  for (const item of left) {
    if (item.companyId !== companyId || now - item.at >= REPLAY_MS) continue;
    void sendSaved(item.provider, item.slot).catch(() => undefined);
  }
}

/** Tests only: forget every wait. */
export function resetDisconnectsForTests(): void {
  entries.clear();
  writeSaved([]);
  changed();
}
