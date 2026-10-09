import { loadSetupState, uploadSetupState } from "./server-store";

/**
 * Per user and company. localStorage is the copy the screens read synchronously; with a company,
 * setup_states on the server keeps the same object across devices (FLOW-506, server-store.ts).
 */

export type SetupStore = {
  run_started_at: string | null;
  run_resumed_at: string | null;
  skipped: Partial<Record<"1" | "2" | "3" | "4" | "5", string>>;
  confirmed_lists_at: string | null;
  sample_review_at: string | null;
  installed_at: string | null;
  ios_steps_seen_at: string | null;
  card_dismissed_at: string | null;
  /** Not in the design jsonb. Keeps "ההגדרה הושלמה." to one show. */
  completed_toast_at: string | null;
};

const SKIP_KEYS = ["1", "2", "3", "4", "5"] as const;

export function emptySetupStore(): SetupStore {
  return {
    run_started_at: null,
    run_resumed_at: null,
    skipped: {},
    confirmed_lists_at: null,
    sample_review_at: null,
    installed_at: null,
    ios_steps_seen_at: null,
    card_dismissed_at: null,
    completed_toast_at: null,
  };
}

export function setupStorageKey(userId: string, companyId: string | null): string {
  return `flow.setup.${userId}.${companyId ?? "none"}`;
}

function stamp(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function parseSetupStore(raw: string | null): SetupStore {
  if (raw == null || raw === "") return emptySetupStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySetupStore();
  }
  if (parsed == null || typeof parsed !== "object") return emptySetupStore();
  const row = parsed as Record<string, unknown>;
  const skipped: SetupStore["skipped"] = {};
  if (row.skipped != null && typeof row.skipped === "object") {
    const bag = row.skipped as Record<string, unknown>;
    for (const key of SKIP_KEYS) {
      const at = stamp(bag[key]);
      if (at) skipped[key] = at;
    }
  }
  return {
    run_started_at: stamp(row.run_started_at),
    run_resumed_at: stamp(row.run_resumed_at),
    skipped,
    confirmed_lists_at: stamp(row.confirmed_lists_at),
    sample_review_at: stamp(row.sample_review_at),
    installed_at: stamp(row.installed_at),
    ios_steps_seen_at: stamp(row.ios_steps_seen_at),
    card_dismissed_at: stamp(row.card_dismissed_at),
    completed_toast_at: stamp(row.completed_toast_at),
  };
}

export function readSetupStore(userId: string | null, companyId: string | null): SetupStore {
  if (!userId || typeof localStorage === "undefined") return emptySetupStore();
  try {
    return parseSetupStore(localStorage.getItem(setupStorageKey(userId, companyId)));
  } catch {
    return emptySetupStore();
  }
}

function writeLocal(userId: string, companyId: string | null, store: SetupStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(setupStorageKey(userId, companyId), JSON.stringify(store));
  } catch {
    // A private-mode write is a no-op. The run still moves in this tab.
  }
}

export function writeSetupStore(userId: string | null, companyId: string | null, store: SetupStore): void {
  if (!userId) return;
  writeLocal(userId, companyId, store);
  if (companyId) uploadSetupState(userId, companyId, store);
}

function isEmptySetupStore(store: SetupStore): boolean {
  return JSON.stringify(store) === JSON.stringify(emptySetupStore());
}

/** FLOW-506. Settles the local copy from the server row once per page load. */
export function loadSetupStore(userId: string, companyId: string): Promise<true> {
  return loadSetupState(userId, companyId, {
    read: () => readSetupStore(userId, companyId),
    write: (store) => { writeLocal(userId, companyId, store); },
    parse: parseSetupStore,
    isEmpty: isEmptySetupStore,
  });
}

const sessionEnteredKey = (userId: string) => `flow.setup.session-entered.${userId}`;
const companyCreatedKey = (userId: string) => `flow.setup.company-created.${userId}`;

function sessionGet(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function sessionSet(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Private mode. This tab may resume twice; the stored flag still limits the next launch.
  }
}

export function sessionEntered(userId: string | null): boolean {
  if (!userId) return false;
  return sessionGet(sessionEnteredKey(userId));
}

export function markSessionEntered(userId: string | null): void {
  if (!userId) return;
  sessionSet(sessionEnteredKey(userId));
}

export function companyCreatedThisRun(userId: string | null): boolean {
  if (!userId) return false;
  return sessionGet(companyCreatedKey(userId));
}

export function markCompanyCreated(userId: string | null): void {
  if (!userId) return;
  sessionSet(companyCreatedKey(userId));
}
