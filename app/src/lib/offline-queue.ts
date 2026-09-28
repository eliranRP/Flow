export interface QueuedOp {
  clientOpId: string;
  name: "create_manual_entry" | "delete_transaction" | "resolve_review" | "set_category_hidden";
  args: Record<string, unknown>;
}

export interface OpStore {
  read(): Promise<QueuedOp[]>;
  write(ops: QueuedOp[]): Promise<void>;
}

export function createOfflineQueue(store: OpStore) {
  return {
    async enqueue(op: QueuedOp): Promise<void> {
      const current = await store.read();
      await store.write([...current.filter((item) => item.clientOpId !== op.clientOpId), op]);
    },
    async pending(): Promise<number> {
      return (await store.read()).length;
    },
    async clear(): Promise<void> {
      await store.write([]);
    },
    async replay(send: (op: QueuedOp) => Promise<void>): Promise<number> {
      const current = await store.read();
      const left: QueuedOp[] = [];
      let sent = 0;
      for (const op of current) {
        try {
          await send(op);
          sent += 1;
        } catch {
          left.push(op);
        }
      }
      await store.write(left);
      return sent;
    },
  };
}

const memory: QueuedOp[] = [];

export const memoryStore: OpStore = {
  read() {
    return Promise.resolve(memory.map((op) => ({ ...op, args: { ...op.args } })));
  },
  write(ops) {
    memory.splice(0, memory.length, ...ops);
    return Promise.resolve();
  },
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("flow", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops");
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB"));
    };
  });
}

export const idbStore: OpStore = {
  async read() {
    if (typeof indexedDB === "undefined") return memoryStore.read();
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ops", "readonly");
      const request = tx.objectStore("ops").get("queue");
      request.onsuccess = () => {
        resolve((request.result as QueuedOp[] | undefined) ?? []);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("read"));
      };
    });
  },
  async write(ops) {
    if (typeof indexedDB === "undefined") return memoryStore.write(ops);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ops", "readwrite");
      tx.objectStore("ops").put(ops, "queue");
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error("write"));
      };
    });
  },
};

export const offlineQueue = createOfflineQueue(idbStore);
