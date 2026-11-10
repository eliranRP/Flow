import { defineMachine } from "@flow/shared";
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

/**
 * One disconnect's wait (FLOW-1167). `waiting` is the ביטול on screen; `send` puts it on the wire, and
 * every other way out (ביטול, another company, a dropped role, a newer wait on the same connection)
 * ends it unsent. `sending` ends once, however the write and the redraw after it go.
 */
export const disconnectFlow = defineMachine({
  name: "disconnectFlow",
  initial: "waiting",
  final: ["gone"],
  states: {
    waiting: { send: "sending", cancel: "gone", refuse: "gone", drop: "gone", replace: "gone" },
    sending: { settle: "gone" },
    gone: {},
  },
});

type DisconnectState = keyof typeof disconnectFlow.states;
type DisconnectEvent = "send" | "cancel" | "refuse" | "drop" | "replace" | "settle";

type Entry = {
  job: DisconnectJob;
  /** The company the app showed at the tap: the disconnect is that company's, or nothing. */
  company: string | null;
  state: DisconnectState;
  /** The write, once `send` has started it. */
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

/** Moves the entry, or answers false when its state does not take the event. */
function move(entry: Entry, event: DisconnectEvent): boolean {
  if (!disconnectFlow.can(entry.state, event)) return false;
  entry.state = disconnectFlow.next(entry.state, event);
  return true;
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
  if (entry.state !== "waiting") return entry.sending ?? Promise.resolve();
  // The state moves before the end callbacks run: one of them closes the toast, whose onClose ends this wait again.
  if (shownCompanyId() !== entry.company) {
    // The header now names another company (or none): the disconnect would land there.
    move(entry, "refuse");
    remove(key, entry);
    ended(entry);
    entry.job.onRefused?.();
    return Promise.resolve();
  }
  move(entry, "send");
  entry.sending = entry.job.send().then(
    async () => {
      try {
        await entry.job.onSent?.();
      } catch {
        // The disconnect went through; only the redraw failed, and the next read draws it.
      } finally {
        move(entry, "settle");
        remove(key, entry);
      }
    },
    (error: unknown) => {
      move(entry, "settle");
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

/** Starts a disconnect's wait, for the company the app shows now. A newer wait on the same connection takes the older one's place, and the older one's toast goes. */
export function startDisconnect(job: DisconnectJob): DisconnectHold {
  const key = keyOf(job.provider, job.slot);
  const entry: Entry = { job, company: shownCompanyId(), state: disconnectFlow.initial, sending: null, ended: [] };
  const older = entries.get(key);
  entries.set(key, entry);
  if (older && move(older, "replace")) ended(older);
  changed();
  return {
    cancel: () => {
      if (!move(entry, "cancel")) return false;
      remove(key, entry);
      return true;
    },
    end: () => send(key, entry),
    onEnd: (run) => { if (entry.state === "waiting") entry.ended.push(run); else run(); },
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
    if ((provider == null || entry.job.provider === provider) && move(entry, "drop")) {
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
