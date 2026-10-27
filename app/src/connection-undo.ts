import { useSyncExternalStore } from "react";
import { shownCompanyId } from "./lib/company-header";

/**
 * Decision 0223: disconnecting Mercury or SUMIT is drawn at once and sent only when its ביטול toast
 * closes, so the key stays on the server until then. The waits live here, outside any screen: a page
 * that unmounts and mounts again still draws the connection as leaving, and the write still goes out.
 * A wait lives in memory only: a reload or a closed tab drops it, and the connection stays connected.
 */
export type ConnectorProvider = "sumit" | "mercury";

/** SUMIT has one connection; Mercury's are numbered by slot. */
export const SUMIT_SLOT = 0;

/** What a page hands over at the tap: how to send the disconnect, and what to do after it. */
export type DisconnectJob = {
  provider: ConnectorProvider;
  slot: number;
  send: () => Promise<void>;
  /** Draws the connection as gone before the wait ends, so it never flickers back while a read runs. */
  onSent?: () => void | Promise<void>;
  onFailed?: (error: Error) => void;
  /** The app shows another company (or none) by the time the wait ends: nothing is sent. */
  onRefused?: () => void;
};

/** A disconnect waiting on its ביטול. */
export type DisconnectHold = {
  /** ביטול: true when it came in time and nothing was sent. */
  cancel: () => boolean;
  /** Sends now (the toast closed, the app was left, a reconnect needs it out of the way). */
  end: () => Promise<void>;
  /** Runs once when the wait ends without a ביטול (sent, refused or dropped), so the page can take its toast away. */
  onEnd: (run: () => void) => void;
};

type Entry = {
  job: DisconnectJob;
  /** The company the app showed at the tap: the disconnect is that company's, or nothing. */
  company: string | null;
  sending: Promise<void> | null;
  ended: Array<() => void>;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const snapshots = new Map<ConnectorProvider, ReadonlySet<number>>();

function keyOf(provider: ConnectorProvider, slot: number): string {
  return `${provider}:${String(slot)}`;
}

function changed() {
  snapshots.clear();
  for (const listener of listeners) listener();
}

function ended(entry: Entry) {
  for (const run of entry.ended.splice(0)) run();
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
  if (shownCompanyId() !== entry.company) {
    // The header now names another company (or none): the disconnect would land there.
    entry.sending = Promise.resolve();
    remove(key, entry);
    ended(entry);
    entry.job.onRefused?.();
    return entry.sending;
  }
  entry.sending = entry.job.send().then(
    async () => {
      await entry.job.onSent?.();
      remove(key, entry);
    },
    (error: unknown) => {
      remove(key, entry);
      entry.job.onFailed?.(error instanceof Error ? error : new Error("failed"));
    },
  );
  changed();
  ended(entry);
  return entry.sending;
}

// Leaving the app ends every wait at once: nobody can tap ביטול any more.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const [key, entry] of [...entries]) void send(key, entry);
  });
}

/** Starts a disconnect's wait, for the company the app shows now. A newer wait on the same connection takes the older one's place. */
export function startDisconnect(job: DisconnectJob): DisconnectHold {
  const key = keyOf(job.provider, job.slot);
  const entry: Entry = { job, company: shownCompanyId(), sending: null, ended: [] };
  entries.set(key, entry);
  changed();
  return {
    cancel: () => {
      if (entries.get(key) !== entry || entry.sending) return false;
      remove(key, entry);
      return true;
    },
    end: () => (entries.get(key) === entry || entry.sending ? send(key, entry) : Promise.resolve()),
    onEnd: (run) => { if (entry.sending || entries.get(key) !== entry) run(); else entry.ended.push(run); },
  };
}

/** Sends every wait of a provider now and waits for them, so a new key is not deleted by an old disconnect. */
export async function flushDisconnects(provider?: ConnectorProvider): Promise<void> {
  await Promise.all([...entries].filter(([, entry]) => provider == null || entry.job.provider === provider).map(([key, entry]) => send(key, entry)));
}

/** Drops waits without sending (a role that cannot disconnect; signing out); their toasts go. How many were dropped. */
export function dropDisconnects(provider?: ConnectorProvider): number {
  let dropped = 0;
  for (const [key, entry] of [...entries]) {
    if ((provider == null || entry.job.provider === provider) && !entry.sending) {
      remove(key, entry);
      ended(entry);
      dropped += 1;
    }
  }
  return dropped;
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

/** Tests only: forget every wait. */
export function resetDisconnectsForTests(): void {
  entries.clear();
  changed();
}
