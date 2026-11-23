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

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error("kept store")); };
    tx.onabort = () => { reject(tx.error ?? new Error("kept store")); };
  });
}

export function idbKeptStore(factory: () => IDBFactory | undefined = () => globalThis.indexedDB): KeptStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise((resolve) => {
      try {
        const request = factory()?.open(DB_NAME, 1);
        if (request == null) { resolve(null); return; }
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { resolve(null); };
        request.onblocked = () => { resolve(null); };
      } catch {
        resolve(null);
      }
    });
    return opened;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => T, fallback: T): Promise<T> => {
    const db = await open();
    if (db == null) return fallback;
    try {
      const tx = db.transaction(STORE, mode);
      const result = work(tx.objectStore(STORE));
      await done(tx);
      return result;
    } catch {
      return fallback;
    }
  };
  return {
    async all() {
      const rows: KeptRow[] = [];
      const db = await open();
      if (db == null) return rows;
      try {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        return await new Promise<KeptRow[]>((resolve) => {
          request.onsuccess = () => { resolve(request.result as KeptRow[]); };
          request.onerror = () => { resolve(rows); };
        });
      } catch {
        return rows;
      }
    },
    put: (rows) => run("readwrite", (store) => {
      // A value that cannot be cloned is not kept; the others are.
      for (const row of rows) {
        try { store.put(row); } catch { /* not kept */ }
      }
    }, undefined),
    remove: (ids) => run("readwrite", (store) => { for (const id of ids) store.delete(id); }, undefined),
    clear: () => run("readwrite", (store) => { store.clear(); }, undefined),
  };
}
