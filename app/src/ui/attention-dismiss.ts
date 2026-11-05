// FLOW-1043: the "דורש טיפול" cards a viewer hid on this device (HANDOFF §2). Each screen keeps its own map
// under `flow.attention.<storageKey>`, row id to the dismissKey it had when hidden; a row whose key has
// changed since (another charge changed, another invoice opened) shows again. Every read and write is in
// try/catch: with storage blocked, the cards still hide for the session (AttentionCards keeps the map).

/** Row id to the dismissKey it had when it was hidden. */
export type HiddenRows = Readonly<Record<string, string>>;

const PREFIX = "flow.attention.";

export function readHidden(storageKey: string): HiddenRows {
  try {
    const raw = window.localStorage.getItem(PREFIX + storageKey);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const hidden: Record<string, string> = {};
    for (const [id, key] of Object.entries(parsed)) if (typeof key === "string") hidden[id] = key;
    return hidden;
  } catch {
    return {};
  }
}

/** Hides one row at its current key, on top of `hidden` (what the screen already holds), and returns the new map. */
export function hideRow(storageKey: string, rowId: string, dismissKey: string, hidden: HiddenRows = readHidden(storageKey)): HiddenRows {
  const next = { ...hidden, [rowId]: dismissKey };
  try {
    window.localStorage.setItem(PREFIX + storageKey, JSON.stringify(next));
  } catch {
    // Storage blocked: the row stays hidden for this visit only.
  }
  return next;
}

export function restoreAll(storageKey: string): void {
  try {
    window.localStorage.removeItem(PREFIX + storageKey);
  } catch {
    // Storage blocked: nothing was kept, so there is nothing to clear.
  }
}

/** A row is hidden while its stored key equals its current one. A row without a dismissKey cannot be hidden. */
export function isRowHidden(hidden: HiddenRows, row: { id: string; dismissKey?: string }): boolean {
  return row.dismissKey != null && hidden[row.id] === row.dismissKey;
}
