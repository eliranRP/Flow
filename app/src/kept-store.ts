/**
 * FLOW-1267: where the kept reads live, IndexedDB, one row per read. A row names its owner (the user and
 * the shown company), the kept-data version it was written under, when the read came in and its size.
 * A store that cannot open (a private window, blocked site data) behaves as an empty one that takes
 * nothing: the app reads the server, as before.
 */
export type KeptRow = {
  /** The query's hash. */
  id: string;
  owner: string;
  version: number;
  /** When the read came in (the query's dataUpdatedAt). */
  at: number;
  /** About how many bytes the row holds. */
  size: number;
  /** The query key, as JSON. */
  key: string;
  data: unknown;
};

export type KeptStore = {
  all(): Promise<KeptRow[]>;
  put(rows: readonly KeptRow[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
};

const DB_NAME = "flow-kept-reads";
const STORE = "reads";

export function idbKeptStore(factory: () => IDBFactory | undefined = () => globalThis.indexedDB): KeptStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise((resolve) => {
      try {
        const request = factory()?.open(DB_NAME, 1);
        if (request == null) { resolve(null); return; }
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = request.onblocked = () => { resolve(null); };
      } catch {
        resolve(null);
      }
    });
    return opened;
  };
  /** Runs the work in one transaction and resolves when it is done; a store that cannot open or fails gives nothing. */
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => T): Promise<T | undefined> => {
    const db = await open();
    try {
      const tx = db?.transaction(STORE, mode);
      const result = tx && work(tx.objectStore(STORE));
      if (tx) await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = reject; });
      return result;
    } catch {
      return undefined;
    }
  };
  return {
    all: async () => ((await run("readonly", (store) => store.getAll()))?.result ?? []) as KeptRow[],
    // A value that cannot be cloned is not kept; the others are.
    put: async (rows) => { await run("readwrite", (store) => { for (const row of rows) try { store.put(row); } catch { /* not kept */ } }); },
    remove: async (ids) => { await run("readwrite", (store) => { for (const id of ids) store.delete(id); }); },
    clear: async () => { await run("readwrite", (store) => { store.clear(); }); },
  };
}
