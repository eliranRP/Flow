import { useEffect, useSyncExternalStore } from "react";

/**
 * FLOW-314: the next page of a paged list, for a card opened from it. The list screen registers how
 * to load more under its address (the walk's `from`); the card at the last loaded row asks for it.
 * The load returns every id loaded so far, in the list's order, and whether the list has more.
 */
export type TxnMoreLoad = () => Promise<{ ids: readonly string[]; more: boolean } | null>;

type Entry = {
  load: TxnMoreLoad;
  more: boolean;
  /** Ids the card loaded past the rows the list showed, in order. */
  extra: readonly string[];
  loading: Promise<void> | null;
};

/** A few lists are enough: the one the card came from, and the ones before it. */
const KEEP = 8;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A paged list screen registers its next page under its address. A fresh visit starts over, so ids
 * a card loaded on an earlier visit never leak into this one. Kept after the screen unmounts: the
 * card opened from it is what reads it.
 */
export function useTxnListMore(from: string, more: boolean, load: TxnMoreLoad | null): void {
  useEffect(() => {
    if (load == null) return;
    const entry = entries.get(from);
    entries.delete(from);
    entries.set(from, { load, more, extra: entry?.load === load ? entry.extra : [], loading: null });
    while (entries.size > KEEP) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    changed();
  }, [from, more, load]);
}

/** Each id once, at its first place: a line shown in parts is one card. */
export function uniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

/** The list's ids with the ones a card loaded since, appended after the last one the list sent. */
export function grownIds(ids: readonly string[], extra: readonly string[]): readonly string[] {
  if (extra.length === 0) return ids;
  const known = new Set(ids);
  const added = extra.filter((id) => !known.has(id));
  return added.length === 0 ? ids : [...ids, ...added];
}

export type TxnListMore = {
  /** Ids loaded past the list's own, in order. */
  extra: readonly string[];
  /** The list has another page to load. */
  more: boolean;
  loading: boolean;
  /** Loads the next page once; a second call while it loads waits on the same read. */
  loadMore: () => Promise<void>;
};

/** What the card knows of its list's next page. Null when the list registered none. */
export function useTxnListMoreFor(from: string | null, shown: readonly string[]): TxnListMore | null {
  useSyncExternalStore(subscribe, () => version);
  const entry = from == null ? undefined : entries.get(from);
  if (from == null || entry == null) return null;
  return {
    extra: entry.extra,
    more: entry.more,
    loading: entry.loading != null,
    loadMore: () => {
      if (entry.loading != null) return entry.loading;
      if (!entry.more) return Promise.resolve();
      const last = [...shown, ...entry.extra].at(-1);
      entry.loading = entry
        .load()
        .then((page) => {
          if (page == null) {
            entry.more = false;
            return;
          }
          // Everything after the last id the card knows: a list sent as a window has a known end.
          const at = last == null ? -1 : page.ids.indexOf(last);
          const known = new Set([...shown, ...entry.extra]);
          entry.extra = [...entry.extra, ...page.ids.slice(at + 1).filter((id) => !known.has(id))];
          entry.more = page.more;
        })
        .catch(() => {
          // A failed read leaves the card where it is; ˅ can try again.
        })
        .finally(() => {
          entry.loading = null;
          changed();
        });
      changed();
      return entry.loading;
    },
  };
}

/** Tests start from an empty store. */
export function resetTxnListMore(): void {
  entries.clear();
  changed();
}
